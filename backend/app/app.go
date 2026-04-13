package app

import (
	"log"
	"os"
	"path/filepath"
	"strings"

	"github.com/aetherproxy/backend/config"
	"github.com/aetherproxy/backend/core"
	coreplugin "github.com/aetherproxy/backend/core/plugin"
	"github.com/aetherproxy/backend/core/plugin/dynamicpadding"
	"github.com/aetherproxy/backend/core/plugin/ech"
	"github.com/aetherproxy/backend/core/plugin/grpcobfs"
	"github.com/aetherproxy/backend/core/plugin/h2disguise"
	"github.com/aetherproxy/backend/core/plugin/multisni"
	"github.com/aetherproxy/backend/core/plugin/mux"
	"github.com/aetherproxy/backend/core/plugin/wscdn"
	"github.com/aetherproxy/backend/cronjob"
	"github.com/aetherproxy/backend/database"
	"github.com/aetherproxy/backend/logger"
	"github.com/aetherproxy/backend/service"
	"github.com/aetherproxy/backend/sub"
	"github.com/aetherproxy/backend/web"

	"github.com/op/go-logging"
)

type APP struct {
	service.SettingService
	configService *service.ConfigService
	webServer     *web.Server
	subServer     *sub.Server
	cronJob       *cronjob.CronJob
	core          *core.Core
}

func NewApp() *APP {
	return &APP{}
}

func (a *APP) Init() error {
	log.Printf("%v %v", config.GetName(), config.GetVersion())

	a.initLog()

	// Warn operators who have not changed the default JWT secret.
	if config.GetJWTSecret() == "change-me-in-production" {
		logger.Warning("⚠️  SECURITY WARNING: AETHER_JWT_SECRET is set to the default value.")
		logger.Warning("⚠️  Please set a strong, unique secret via the AETHER_JWT_SECRET environment variable.")
		logger.Warning("⚠️  Running with the default secret exposes your panel to session forgery attacks.")
	}

	err := database.InitDB(config.GetDBPath())
	if err != nil {
		return err
	}

	// Init Setting
	_, _ = a.GetAllSetting()

	a.core = core.NewCore()

	a.cronJob = cronjob.NewCronJob()
	a.webServer = web.NewServer()
	a.subServer = sub.NewServer()

	a.configService = service.NewConfigService(a.core)

	a.registerBuiltinPlugins()
	a.LoadPluginStates()

	return nil
}

func (a *APP) Start() error {
	loc, err := a.GetTimeLocation()
	if err != nil {
		return err
	}

	trafficAge, err := a.GetTrafficAge()
	if err != nil {
		return err
	}

	err = a.cronJob.Start(loc, trafficAge)
	if err != nil {
		return err
	}

	err = a.webServer.Start()
	if err != nil {
		return err
	}

	err = a.subServer.Start()
	if err != nil {
		return err
	}

	a.loadPlugins()

	err = a.configService.StartCore()
	if err != nil {
		logger.Error(err)
	}

	// Start multi-node health checks
	service.GetNodeService().StartAllHealthChecks()

	// Auto-start decentralized discovery when bootstrap peers are configured.
	if len(config.GetGossipBootstrap()) > 0 || config.GetGossipManifestURL() != "" {
		if err := service.GetDiscoveryService().Start(); err != nil {
			logger.Warning("Discovery auto-start failed:", err)
		} else {
			logger.Info("Discovery service auto-started")
		}
	}

	service.GetPortSyncService().TriggerImmediateSync("startup")

	// Start evasion watcher (censorship monitor)
	service.GetEvasionWatcher().Start()

	return nil
}

func (a *APP) Stop() {
	a.cronJob.Stop()
	service.GetEvasionWatcher().Stop()
	service.GetDiscoveryService().Stop()
	err := a.subServer.Stop()
	if err != nil {
		logger.Warning("stop Sub Server err:", err)
	}
	err = a.webServer.Stop()
	if err != nil {
		logger.Warning("stop Web Server err:", err)
	}
	err = a.configService.StopCore()
	if err != nil {
		logger.Warning("stop Core err:", err)
	}
}

func (a *APP) initLog() {
	switch config.GetLogLevel() {
	case config.Debug:
		logger.InitLogger(logging.DEBUG)
	case config.Info:
		logger.InitLogger(logging.INFO)
	case config.Warn:
		logger.InitLogger(logging.WARNING)
	case config.Error:
		logger.InitLogger(logging.ERROR)
	default:
		log.Fatal("unknown log level:", config.GetLogLevel())
	}
}

func (a *APP) registerBuiltinPlugins() {
	coreplugin.RegisterPlugin(h2disguise.Plugin)
	coreplugin.RegisterPlugin(wscdn.Plugin)
	coreplugin.RegisterPlugin(grpcobfs.Plugin)
	coreplugin.RegisterPlugin(ech.Plugin)
	coreplugin.RegisterPlugin(mux.Plugin)
	coreplugin.RegisterPlugin(multisni.Plugin)
	coreplugin.RegisterPlugin(dynamicpadding.Plugin)
}

func (a *APP) loadPlugins() {
	dir := config.GetPluginsDir()
	entries, err := os.ReadDir(dir)
	if err != nil {
		logger.Info("plugins dir not found or empty, skipping:", dir)
		return
	}
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".so") {
			continue
		}
		path := filepath.Join(dir, e.Name())
		if err := coreplugin.LoadPlugin(path); err != nil {
			logger.Warning("failed to load plugin:", path, err)
		} else {
			logger.Info("loaded plugin:", path)
		}
	}
}

func (a *APP) RestartApp() {
	a.Stop()
	_ = a.Start()
}

func (a *APP) GetCore() *core.Core {
	return a.core
}
