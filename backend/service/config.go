package service

import (
	"encoding/json"
	"strconv"
	"sync"
	"time"

	"golang.org/x/sync/errgroup"

	"github.com/aetherproxy/backend/core"
	"github.com/aetherproxy/backend/database"
	"github.com/aetherproxy/backend/database/model"
	"github.com/aetherproxy/backend/logger"
	"github.com/aetherproxy/backend/util/common"
)

var (
	LastUpdate          int64
	corePtr             *core.Core
	startCoreMu         sync.Mutex
	startCoreInProgress bool
	lastStartFailTime   time.Time
	startCooldown       = 15 * time.Second
)

type ConfigService struct {
	ClientService
	TlsService
	SettingService
	InboundService
	OutboundService
	ServicesService
	EndpointService
}

type SingBoxConfig struct {
	Log          json.RawMessage   `json:"log"`
	Dns          json.RawMessage   `json:"dns"`
	Ntp          json.RawMessage   `json:"ntp"`
	Inbounds     []json.RawMessage `json:"inbounds"`
	Outbounds    []json.RawMessage `json:"outbounds"`
	Services     []json.RawMessage `json:"services"`
	Endpoints    []json.RawMessage `json:"endpoints"`
	Route        json.RawMessage   `json:"route"`
	Experimental json.RawMessage   `json:"experimental"`
}

func NewConfigService(core *core.Core) *ConfigService {
	corePtr = core
	return &ConfigService{}
}

func (s *ConfigService) GetConfig(data string) (*[]byte, error) {
	var err error
	if len(data) == 0 {
		data, err = s.SettingService.GetConfig()
		if err != nil {
			return nil, err
		}
	}
	singboxConfig := SingBoxConfig{}
	err = json.Unmarshal([]byte(data), &singboxConfig)
	if err != nil {
		return nil, err
	}

	db := database.GetDB()

	// Fan out the four independent DB queries in parallel.
	var eg errgroup.Group
	eg.Go(func() error {
		var e error
		singboxConfig.Inbounds, e = s.InboundService.GetAllConfig(db)
		return e
	})
	eg.Go(func() error {
		var e error
		singboxConfig.Outbounds, e = s.OutboundService.GetAllConfig(db)
		return e
	})
	eg.Go(func() error {
		var e error
		singboxConfig.Services, e = s.ServicesService.GetAllConfig(db)
		return e
	})
	eg.Go(func() error {
		var e error
		singboxConfig.Endpoints, e = s.EndpointService.GetAllConfig(db)
		return e
	})
	if err = eg.Wait(); err != nil {
		return nil, err
	}

	// Use compact JSON for the sing-box config that is passed to the core.
	// The human-readable version is produced by GetConfigIndented when
	// the admin panel requests a downloadable copy.
	rawConfig, err := json.Marshal(singboxConfig)
	if err != nil {
		return nil, err
	}
	return &rawConfig, nil
}

// GetConfigIndented returns the sing-box config as pretty-printed JSON.
// It is used by the admin API download endpoint so that the file is
// human-readable; the core always receives the compact form via GetConfig.
func (s *ConfigService) GetConfigIndented(data string) (*[]byte, error) {
	rawConfig, err := s.GetConfig(data)
	if err != nil {
		return nil, err
	}
	var obj interface{}
	if err = json.Unmarshal(*rawConfig, &obj); err != nil {
		return nil, err
	}
	indented, err := json.MarshalIndent(obj, "", "  ")
	if err != nil {
		return nil, err
	}
	return &indented, nil
}

func (s *ConfigService) StartCore() error {
	if corePtr.IsRunning() {
		return nil
	}
	startCoreMu.Lock()
	if startCoreInProgress {
		startCoreMu.Unlock()
		return nil
	}
	if time.Since(lastStartFailTime) < startCooldown {
		logger.InfofThrottled("core.start.cooldown", 30*time.Second, "start core cooldown %d seconds", startCooldown/time.Second)
		startCoreMu.Unlock()
		return nil
	}
	startCoreInProgress = true
	startCoreMu.Unlock()
	defer func() {
		startCoreMu.Lock()
		startCoreInProgress = false
		startCoreMu.Unlock()
	}()

	logger.InfoThrottled("core.start.attempt", 20*time.Second, "starting core")
	rawConfig, err := s.GetConfig("")
	if err != nil {
		logger.WarningfThrottled("core.start.config_error", 20*time.Second, "start core get config failed: %v", err)
		return err
	}
	err = corePtr.Start(*rawConfig)
	if err != nil {
		startCoreMu.Lock()
		lastStartFailTime = time.Now()
		startCoreMu.Unlock()
		logger.ErrorfThrottled("core.start.failed", 20*time.Second, "start sing-box err: %v", err)
		return err
	}
	logger.Info("sing-box started")
	return nil
}

func (s *ConfigService) RestartCore() error {
	err := s.StopCore()
	if err != nil {
		return err
	}
	return s.StartCore()
}

func (s *ConfigService) restartCoreWithConfig(config json.RawMessage) error {
	startCoreMu.Lock()
	if startCoreInProgress {
		startCoreMu.Unlock()
		return nil
	}
	startCoreInProgress = true
	startCoreMu.Unlock()
	defer func() {
		startCoreMu.Lock()
		startCoreInProgress = false
		startCoreMu.Unlock()
	}()

	if corePtr.IsRunning() {
		if err := corePtr.Stop(); err != nil {
			logger.Error("restart sing-box err (stop):", err.Error())
			return err
		}
	}
	rawConfig, err := s.GetConfig(string(config))
	if err != nil {
		logger.Error("restart sing-box err (get config):", err.Error())
		return err
	}
	if err := corePtr.Start(*rawConfig); err != nil {
		logger.Error("restart sing-box err (start):", err.Error())
		return err
	}
	logger.Info("sing-box restarted with new config")
	return nil
}

func (s *ConfigService) StopCore() error {
	err := corePtr.Stop()
	if err != nil {
		return err
	}
	logger.Info("sing-box stopped")
	return nil
}

func (s *ConfigService) CheckOutbound(tag string, link string) core.CheckOutboundResult {
	if tag == "" {
		return core.CheckOutboundResult{Error: "missing query parameter: tag"}
	}
	if corePtr == nil || !corePtr.IsRunning() {
		return core.CheckOutboundResult{Error: "core not running"}
	}
	return core.CheckOutbound(corePtr.GetCtx(), tag, link)
}

func (s *ConfigService) Save(obj string, act string, data json.RawMessage, initUsers string, loginUser string, hostname string) ([]string, error) {
	var err error
	objs := []string{obj}
	triggerPortSync := false
	portSyncReason := ""

	db := database.GetDB()
	tx := db.Begin()
	defer func() {
		if err == nil {
			tx.Commit()
			if triggerPortSync {
				GetPortSyncService().TriggerImmediateSync(portSyncReason)
			}
			// Try to start core if it is not running
			if !corePtr.IsRunning() {
				_ = s.StartCore()
			}
		} else {
			tx.Rollback()
		}
	}()

	switch obj {
	case "clients":
		var inboundIds []uint
		inboundIds, err = s.ClientService.Save(tx, act, data, hostname)
		if err == nil && len(inboundIds) > 0 {
			objs = append(objs, "inbounds")
			err = s.RestartInbounds(tx, inboundIds)
			if err != nil {
				return nil, common.NewErrorf("failed to update users for inbounds: %v", err)
			}
		}
	case "tls":
		err = s.TlsService.Save(tx, act, data, hostname)
		objs = append(objs, "clients", "inbounds")
	case "inbounds":
		err = s.InboundService.Save(tx, act, data, initUsers, hostname)
		objs = append(objs, "clients")
		triggerPortSync = true
		portSyncReason = "inbounds:" + act
	case "outbounds":
		err = s.OutboundService.Save(tx, act, data)
	case "services":
		err = s.ServicesService.Save(tx, act, data)
	case "endpoints":
		err = s.EndpointService.Save(tx, act, data)
	case "config":
		err = s.SaveConfig(tx, data)
		if err != nil {
			return nil, err
		}
		configData := make(json.RawMessage, len(data))
		copy(configData, data)
		go func() { _ = s.restartCoreWithConfig(configData) }()
	case "settings":
		err = s.SettingService.Save(tx, data)
	default:
		return nil, common.NewError("unknown object: ", obj)
	}
	if err != nil {
		return nil, err
	}

	dt := time.Now().Unix()
	err = tx.Create(&model.Changes{
		DateTime: dt,
		Actor:    loginUser,
		Key:      obj,
		Action:   act,
		Obj:      data,
	}).Error
	if err != nil {
		return nil, err
	}

	LastUpdate = time.Now().Unix()

	return objs, nil
}

func (s *ConfigService) CheckChanges(lu string) (bool, error) {
	if lu == "" {
		return true, nil
	}
	if LastUpdate == 0 {
		db := database.GetDB()
		var count int64
		err := db.Model(model.Changes{}).Where("date_time > ?", lu).Count(&count).Error
		if err == nil {
			LastUpdate = time.Now().Unix()
		}
		return count > 0, err
	} else {
		intLu, err := strconv.ParseInt(lu, 10, 64)
		return LastUpdate > intLu, err
	}
}

func (s *ConfigService) GetChanges(actor string, chngKey string, count string) []model.Changes {
	c, _ := strconv.Atoi(count)
	if c <= 0 {
		c = 50
	}
	db := database.GetDB()
	q := db.Model(model.Changes{})
	if len(actor) > 0 {
		q = q.Where("actor = ?", actor)
	}
	if len(chngKey) > 0 {
		q = q.Where("key = ?", chngKey)
	}
	var chngs []model.Changes
	err := q.Order("id desc").Limit(c).Scan(&chngs).Error
	if err != nil {
		logger.Warning(err)
	}
	return chngs
}

// restartCoreAsync schedules an asynchronous sing-box restart using the
// supplied raw config.  It is a package-level helper so that services in the
// same package can trigger a restart without embedding ConfigService.
func restartCoreAsync(config json.RawMessage) {
	cs := &ConfigService{}
	go func() {
		if err := cs.restartCoreWithConfig(config); err != nil {
			logger.Error("restartCoreAsync: sing-box restart failed:", err)
		}
	}()
}
