package api

import (
	"archive/zip"
	"bytes"
	"encoding/base64"
	"encoding/json"
	"strconv"
	"strings"
	"time"

	"github.com/aetherproxy/backend/core/plugin"
	"github.com/aetherproxy/backend/database"
	"github.com/aetherproxy/backend/database/model"
	"github.com/aetherproxy/backend/logger"
	"github.com/aetherproxy/backend/service"
	"github.com/aetherproxy/backend/util"
	"github.com/aetherproxy/backend/util/common"

	"github.com/gin-gonic/gin"
)

type ApiService struct {
	service.SettingService
	service.UserService
	service.ConfigService
	service.ClientService
	service.TlsService
	service.InboundService
	service.OutboundService
	service.EndpointService
	service.ServicesService
	service.PanelService
	service.StatsService
	service.ServerService
	service.RoutingService
	service.CertService
}

func (a *ApiService) LoadData(c *gin.Context) {
	data, err := a.getData(c)
	if err != nil {
		jsonMsg(c, "", err)
		return
	}
	jsonObj(c, data, nil)
}

func (a *ApiService) getData(c *gin.Context) (interface{}, error) {
	data := make(map[string]interface{}, 0)
	lu := c.Query("lu")
	isUpdated, err := a.ConfigService.CheckChanges(lu)
	if err != nil {
		return "", err
	}
	onlines, err := a.StatsService.GetOnlines()

	sysInfo := a.GetSingboxInfo()
	if sysInfo["running"] == false {
		logs := a.ServerService.GetLogs("1", "debug")
		if len(logs) > 0 {
			data["lastLog"] = logs[0]
		}
	}

	if err != nil {
		return "", err
	}
	if isUpdated {
		config, err := a.SettingService.GetConfig()
		if err != nil {
			return "", err
		}
		clients, err := a.ClientService.GetAll()
		if err != nil {
			return "", err
		}
		tlsConfigs, err := a.TlsService.GetAll()
		if err != nil {
			return "", err
		}
		inbounds, err := a.InboundService.GetAll()
		if err != nil {
			return "", err
		}
		outbounds, err := a.OutboundService.GetAll()
		if err != nil {
			return "", err
		}
		endpoints, err := a.EndpointService.GetAll()
		if err != nil {
			return "", err
		}
		services, err := a.ServicesService.GetAll()
		if err != nil {
			return "", err
		}
		subURI, err := a.GetFinalSubURI(getHostname(c))
		if err != nil {
			return "", err
		}
		trafficAge, err := a.GetTrafficAge()
		if err != nil {
			return "", err
		}
		data["config"] = json.RawMessage(config)
		data["clients"] = clients
		data["tls"] = tlsConfigs
		data["inbounds"] = inbounds
		data["outbounds"] = outbounds
		data["endpoints"] = endpoints
		data["services"] = services
		data["subURI"] = subURI
		data["enableTraffic"] = trafficAge > 0
		data["onlines"] = onlines
	} else {
		data["onlines"] = onlines
	}

	return data, nil
}

func (a *ApiService) LoadPartialData(c *gin.Context, objs []string) error {
	data := make(map[string]interface{}, 0)
	id := c.Query("id")

	for _, obj := range objs {
		switch obj {
		case "inbounds":
			inbounds, err := a.InboundService.Get(id)
			if err != nil {
				return err
			}
			data[obj] = inbounds
		case "outbounds":
			outbounds, err := a.OutboundService.GetAll()
			if err != nil {
				return err
			}
			data[obj] = outbounds
		case "endpoints":
			endpoints, err := a.EndpointService.GetAll()
			if err != nil {
				return err
			}
			data[obj] = endpoints
		case "services":
			services, err := a.ServicesService.GetAll()
			if err != nil {
				return err
			}
			data[obj] = services
		case "tls":
			tlsConfigs, err := a.TlsService.GetAll()
			if err != nil {
				return err
			}
			data[obj] = tlsConfigs
		case "clients":
			clients, err := a.ClientService.Get(id)
			if err != nil {
				return err
			}
			data[obj] = clients
		case "config":
			config, err := a.SettingService.GetConfig()
			if err != nil {
				return err
			}
			data[obj] = json.RawMessage(config)
		case "settings":
			settings, err := a.GetAllSetting()
			if err != nil {
				return err
			}
			data[obj] = settings
		}
	}

	jsonObj(c, data, nil)
	return nil
}

func (a *ApiService) GetUsers(c *gin.Context) {
	users, err := a.UserService.GetUsers()
	if err != nil {
		jsonMsg(c, "", err)
		return
	}
	jsonObj(c, *users, nil)
}

func (a *ApiService) GetSettings(c *gin.Context) {
	data, err := a.GetAllSetting()
	if err != nil {
		jsonMsg(c, "", err)
		return
	}
	jsonObj(c, data, err)
}

func (a *ApiService) GetStats(c *gin.Context) {
	resource := c.Query("resource")
	tag := c.Query("tag")
	limit, err := strconv.Atoi(c.Query("limit"))
	if err != nil {
		limit = 100
	}
	data, err := a.StatsService.GetStats(resource, tag, limit)
	if err != nil {
		jsonMsg(c, "", err)
		return
	}
	jsonObj(c, data, err)
}

func (a *ApiService) GetStatus(c *gin.Context) {
	request := c.Query("r")
	result := a.ServerService.GetStatus(request)
	jsonObj(c, result, nil)
}

func (a *ApiService) GetOnlines(c *gin.Context) {
	onlines, err := a.StatsService.GetOnlines()
	jsonObj(c, onlines, err)
}

func (a *ApiService) GetLogs(c *gin.Context) {
	count := c.Query("c")
	level := c.Query("l")
	logs := a.ServerService.GetLogs(count, level)
	jsonObj(c, logs, nil)
}

func (a *ApiService) CheckChanges(c *gin.Context) {
	actor := c.Query("a")
	chngKey := c.Query("k")
	count := c.Query("c")
	changes := a.GetChanges(actor, chngKey, count)
	jsonObj(c, changes, nil)
}

func (a *ApiService) GetKeypairs(c *gin.Context) {
	kType := c.Query("k")
	options := c.Query("o")
	keypair := a.GenKeypair(kType, options)
	jsonObj(c, keypair, nil)
}

func (a *ApiService) GetDb(c *gin.Context) {
	exclude := c.Query("exclude")
	db, err := database.GetDb(exclude)
	if err != nil {
		jsonMsg(c, "", err)
		return
	}
	c.Header("Content-Type", "application/octet-stream")
	c.Header("Content-Disposition", "attachment; filename=s-ui_"+time.Now().Format("20060102-150405")+".db")
	_, _ = c.Writer.Write(db)
}

func (a *ApiService) Login(c *gin.Context) {
	remoteIP := getRemoteIp(c)
	loginUser, err := a.UserService.Login(c.Request.FormValue("user"), c.Request.FormValue("pass"), remoteIP)
	if err != nil {
		jsonMsg(c, "", err)
		return
	}

	sessionMaxAge, err := a.GetSessionMaxAge()
	if err != nil {
		logger.Infof("Unable to get session's max age from DB")
	}

	err = SetLoginUser(c, loginUser, sessionMaxAge)
	if err == nil {
		logger.Info("user ", loginUser, " login success")
	} else {
		logger.Warning("login failed: ", err)
		jsonMsg(c, "", err)
		return
	}

	jsonObj(c, gin.H{"token": GetIssuedToken(c)}, nil)
}

func (a *ApiService) ChangePass(c *gin.Context) {
	id := c.Request.FormValue("id")
	// If id is not provided, resolve it from the authenticated session user.
	if id == "" || id == "0" {
		username := GetLoginUser(c)
		if username != "" {
			user, err := a.GetUserByUsername(username)
			if err == nil && user != nil {
				id = strconv.FormatUint(uint64(user.Id), 10)
			}
		}
	}
	oldPass := c.Request.FormValue("oldPass")
	newUsername := c.Request.FormValue("newUsername")
	newPass := c.Request.FormValue("newPass")
	err := a.UserService.ChangePass(id, oldPass, newUsername, newPass)
	if err == nil {
		logger.Info("change user credentials success")
		jsonMsg(c, "save", nil)
	} else {
		logger.Warning("change user credentials failed:", err)
		jsonMsg(c, "", err)
	}
}

func (a *ApiService) Save(c *gin.Context, loginUser string) {
	hostname := getHostname(c)
	obj := c.Request.FormValue("object")
	act := c.Request.FormValue("action")
	data := c.Request.FormValue("data")
	initUsers := c.Request.FormValue("initUsers")
	objs, err := a.ConfigService.Save(obj, act, json.RawMessage(data), initUsers, loginUser, hostname)
	if err != nil {
		jsonMsg(c, "save", err)
		return
	}
	err = a.LoadPartialData(c, objs)
	if err != nil {
		jsonMsg(c, obj, err)
	}
}

func (a *ApiService) RestartApp(c *gin.Context) {
	err := a.RestartPanel(3)
	jsonMsg(c, "restartApp", err)
}

func (a *ApiService) RestartSb(c *gin.Context) {
	err := a.RestartCore()
	jsonMsg(c, "restartSb", err)
}

func (a *ApiService) LinkConvert(c *gin.Context) {
	link := c.Request.FormValue("link")
	result, _, err := util.GetOutbound(link, 0)
	jsonObj(c, result, err)
}

func (a *ApiService) SubConvert(c *gin.Context) {
	link := c.Request.FormValue("link")
	result, err := util.GetExternalSub(link)
	jsonObj(c, result, err)
}

func (a *ApiService) ImportDb(c *gin.Context) {
	file, _, err := c.Request.FormFile("db")
	if err != nil {
		jsonMsg(c, "", err)
		return
	}
	defer func() { _ = file.Close() }()
	err = database.ImportDB(file)
	jsonMsg(c, "", err)
}

func (a *ApiService) Logout(c *gin.Context) {
	loginUser := GetLoginUser(c)
	if loginUser != "" {
		logger.Infof("user %s logout", loginUser)
	}
	ClearSession(c)
	jsonMsg(c, "", nil)
}

func (a *ApiService) LoadTokens() ([]byte, error) {
	return a.UserService.LoadTokens()
}

func (a *ApiService) GetTokens(c *gin.Context) {
	loginUser := GetLoginUser(c)
	tokens, err := a.GetUserTokens(loginUser)
	jsonObj(c, tokens, err)
}

func (a *ApiService) AddToken(c *gin.Context) {
	loginUser := GetLoginUser(c)
	expiry := c.Request.FormValue("expiry")
	expiryInt, err := strconv.ParseInt(expiry, 10, 64)
	if err != nil {
		jsonMsg(c, "", err)
		return
	}
	desc := c.Request.FormValue("desc")
	token, err := a.UserService.AddToken(loginUser, expiryInt, desc)
	jsonObj(c, token, err)
}

func (a *ApiService) DeleteToken(c *gin.Context) {
	tokenId := c.Request.FormValue("id")
	err := a.UserService.DeleteToken(tokenId)
	jsonMsg(c, "", err)
}

func (a *ApiService) GetSingboxConfig(c *gin.Context) {
	rawConfig, err := a.GetConfigIndented("")
	if err != nil {
		c.Status(400)
		_, _ = c.Writer.WriteString(err.Error())
		return
	}
	c.Header("Content-Type", "application/json")
	c.Header("Content-Disposition", "attachment; filename=config_"+time.Now().Format("20060102-150405")+".json")
	_, _ = c.Writer.Write(*rawConfig)
}

func (a *ApiService) GetCheckOutbound(c *gin.Context) {
	tag := c.Query("tag")
	link := c.Query("link")
	result := a.CheckOutbound(tag, link)
	jsonObj(c, result, nil)
}

// ── Nodes ─────────────────────────────────────────────────────────────────────

func (a *ApiService) GetNodes(c *gin.Context) {
	nodes, err := service.GetNodeService().GetAll()
	jsonObj(c, nodes, err)
}

func (a *ApiService) CreateNode(c *gin.Context) {
	var node model.Node
	if err := c.ShouldBind(&node); err != nil {
		jsonMsg(c, "", err)
		return
	}
	if err := service.GetNodeService().Create(&node); err != nil {
		jsonMsg(c, "", err)
		return
	}
	jsonObj(c, node, nil)
}

func (a *ApiService) UpdateNode(c *gin.Context) {
	var node model.Node
	if err := c.ShouldBind(&node); err != nil {
		jsonMsg(c, "", err)
		return
	}
	if err := service.GetNodeService().Update(&node); err != nil {
		jsonMsg(c, "", err)
		return
	}
	jsonObj(c, node, nil)
}

func (a *ApiService) DeleteNode(c *gin.Context) {
	var req struct {
		Id uint `form:"id"`
	}
	if err := c.ShouldBind(&req); err != nil {
		jsonMsg(c, "", err)
		return
	}
	err := service.GetNodeService().Delete(req.Id)
	jsonMsg(c, "", err)
}

func (a *ApiService) DeployNode(c *gin.Context) {
	var req struct {
		Id uint `form:"id"`
	}
	if err := c.ShouldBind(&req); err != nil {
		jsonMsg(c, "", err)
		return
	}
	rawConfig, err := a.ConfigService.GetConfig("")
	if err != nil {
		jsonMsg(c, "", err)
		return
	}
	err = service.GetNodeService().DeployConfig(req.Id, *rawConfig)
	if err == nil {
		service.GetPortSyncService().TriggerNodeImmediateSync(req.Id, "deploy-node")
	}
	jsonMsg(c, "deploy", err)
}

func (a *ApiService) GetPortSyncStatus(c *gin.Context) {
	limit, err := strconv.Atoi(c.DefaultQuery("limit", "30"))
	if err != nil || limit <= 0 {
		limit = 30
	}
	status, err := service.GetPortSyncService().GetStatus(limit)
	jsonObj(c, status, err)
}

func (a *ApiService) TriggerPortSync(c *gin.Context) {
	var req struct {
		NodeId uint   `form:"nodeId"`
		Reason string `form:"reason"`
	}
	if err := c.ShouldBind(&req); err != nil {
		jsonMsg(c, "", err)
		return
	}
	reason := req.Reason
	if reason == "" {
		reason = "manual-api"
	}
	if req.NodeId > 0 {
		service.GetPortSyncService().TriggerNodeImmediateSync(req.NodeId, reason)
	} else {
		service.GetPortSyncService().TriggerImmediateSync(reason)
	}
	jsonObj(c, gin.H{"queued": true, "nodeId": req.NodeId, "reason": reason}, nil)
}

func (a *ApiService) RetryPortSync(c *gin.Context) {
	limit, err := strconv.Atoi(c.DefaultPostForm("limit", "30"))
	if err != nil || limit <= 0 {
		limit = 30
	}
	err = service.GetPortSyncService().ProcessDueTasks(limit)
	jsonMsg(c, "portsyncRetry", err)
}

func (a *ApiService) ClearPortSync(c *gin.Context) {
	var req struct {
		Scope  string `form:"scope"`
		NodeId uint   `form:"nodeId"`
	}
	if err := c.ShouldBind(&req); err != nil {
		jsonMsg(c, "", err)
		return
	}
	deleted, err := service.GetPortSyncService().ClearTasks(req.Scope, req.NodeId)
	jsonObj(c, gin.H{"deleted": deleted, "scope": req.Scope, "nodeId": req.NodeId}, err)
}

// ── Routing ───────────────────────────────────────────────────────────────────

func (a *ApiService) GetRouting(c *gin.Context) {
	rules, err := a.GetRules()
	jsonObj(c, rules, err)
}

func (a *ApiService) SaveRouting(c *gin.Context) {
	var rules []service.RouteRule
	if err := c.ShouldBindJSON(&rules); err != nil {
		jsonMsg(c, "", err)
		return
	}
	err := a.SaveRules(rules)
	jsonMsg(c, "routing", err)
}

// ── Analytics ─────────────────────────────────────────────────────────────────

func (a *ApiService) GetAnalytics(c *gin.Context) {
	limitH, err := strconv.Atoi(c.DefaultQuery("h", "24"))
	if err != nil || limitH <= 0 {
		limitH = 24
	}

	// Aggregate stats per tag and direction over the requested window.
	db := database.GetDB()
	cutoff := time.Now().Unix() - int64(limitH)*3600

	type row struct {
		Tag       string `json:"tag"`
		Direction bool   `json:"direction"`
		Total     int64  `json:"total"`
	}
	var rows []row
	err = db.Raw(`SELECT tag, direction, SUM(traffic) AS total
		FROM stats
		WHERE resource = 'inbound' AND date_time > ?
		GROUP BY tag, direction
		ORDER BY tag, direction`, cutoff).Scan(&rows).Error
	if err != nil {
		jsonMsg(c, "", err)
		return
	}

	// Pivot into per-tag up/down map
	type tagStats struct {
		Up   int64 `json:"up"`
		Down int64 `json:"down"`
	}
	result := make(map[string]*tagStats)
	for _, r := range rows {
		if _, ok := result[r.Tag]; !ok {
			result[r.Tag] = &tagStats{}
		}
		if r.Direction {
			result[r.Tag].Up = r.Total
		} else {
			result[r.Tag].Down = r.Total
		}
	}

	// Also include recent evasion events
	evasionEvents, _ := service.GetRecentEvasionEvents(50)

	jsonObj(c, gin.H{
		"perProtocol":   result,
		"evasionEvents": evasionEvents,
		"windowHours":   limitH,
	}, nil)
}

// ── Plugins ───────────────────────────────────────────────────────────────────

func (a *ApiService) GetPlugins(c *gin.Context) {
	infos := plugin.List()
	type pluginDTO struct {
		Name        string          `json:"name"`
		Description string          `json:"description"`
		Enabled     bool            `json:"enabled"`
		Config      json.RawMessage `json:"config"`
	}
	result := make([]pluginDTO, 0, len(infos))
	for _, info := range infos {
		result = append(result, pluginDTO{
			Name:        info.Plugin.Name(),
			Description: info.Plugin.Description(),
			Enabled:     info.Plugin.Enabled(),
			Config:      info.Config,
		})
	}
	jsonObj(c, result, nil)
}

func (a *ApiService) SetPluginEnabled(c *gin.Context) {
	name := c.Request.FormValue("name")
	enabled := c.Request.FormValue("enabled") == "true"
	info := plugin.Get(name)
	if info == nil {
		jsonMsg(c, "", common.NewError("plugin not found: ", name))
		return
	}
	info.Plugin.SetEnabled(enabled)
	if err := a.SavePluginEnabled(name, enabled); err != nil {
		logger.Warning("failed to persist plugin enabled state:", err)
	}
	jsonMsg(c, "plugin", nil)
}

func (a *ApiService) SetPluginConfig(c *gin.Context) {
	name := c.Request.FormValue("name")
	cfg := json.RawMessage(c.Request.FormValue("config"))
	if err := plugin.SetConfig(name, cfg); err != nil {
		jsonMsg(c, "plugin", err)
		return
	}
	if err := a.SavePluginConfig(name, cfg); err != nil {
		logger.Warning("failed to persist plugin config:", err)
	}
	jsonMsg(c, "plugin", nil)
}

// ── Certificate provisioning ──────────────────────────────────────────────────

// IssueCert triggers a Let's Encrypt HTTP-01 ACME challenge for a domain and
// writes the resulting certificate and private key to disk.
// POST /api/issueCert  form-fields: domain, email (optional)
func (a *ApiService) IssueCert(c *gin.Context) {
	domain := c.Request.FormValue("domain")
	email := c.Request.FormValue("email")
	certPath, keyPath, err := a.IssueLetsEncrypt(domain, email)
	if err != nil {
		jsonMsg(c, "", err)
		return
	}
	jsonObj(c, gin.H{"cert_path": certPath, "key_path": keyPath}, nil)
}

// SaveCert persists PEM-encoded certificate and key content submitted by the
// user (e.g. a Cloudflare Origin Certificate) and returns the file paths.
// POST /api/saveCert  form-fields: tag, cert, key
func (a *ApiService) SaveCert(c *gin.Context) {
	tag := c.Request.FormValue("tag")
	cert := c.Request.FormValue("cert")
	key := c.Request.FormValue("key")
	certPath, keyPath, err := a.SavePastedCert(tag, cert, key)
	if err != nil {
		jsonMsg(c, "", err)
		return
	}
	jsonObj(c, gin.H{"cert_path": certPath, "key_path": keyPath}, nil)
}

// ── Decentralized Node Discovery ──────────────────────────────────────────────

func (a *ApiService) GetDiscoveryStatus(c *gin.Context) {
	svc := service.GetDiscoveryService()
	running := svc.IsRunning()
	var memberCount int
	if running {
		memberCount = len(svc.GetPeers())
	}
	jsonObj(c, gin.H{
		"running":     running,
		"memberCount": memberCount,
	}, nil)
}

func (a *ApiService) GetDiscoveryPeers(c *gin.Context) {
	peers, err := service.GetDiscoveryService().GetStoredPeers()
	jsonObj(c, peers, err)
}

func (a *ApiService) DiscoveryJoin(c *gin.Context) {
	svc := service.GetDiscoveryService()
	if svc.IsRunning() {
		service.GetPortSyncService().TriggerImmediateSync("discovery-join")
		jsonMsg(c, "discovery", nil)
		return
	}
	err := svc.Start()
	if err == nil {
		service.GetPortSyncService().TriggerImmediateSync("discovery-join")
	}
	jsonMsg(c, "discovery", err)
}

func (a *ApiService) DiscoveryLeave(c *gin.Context) {
	service.GetDiscoveryService().Stop()
	service.GetPortSyncService().TriggerImmediateSync("discovery-leave")
	jsonMsg(c, "discovery", nil)
}

func (a *ApiService) DiscoveryAddPeer(c *gin.Context) {
	addr := c.Request.FormValue("addr")
	if addr == "" {
		jsonMsg(c, "", common.NewError("addr is required"))
		return
	}
	err := service.GetDiscoveryService().JoinPeer(addr)
	jsonMsg(c, "discovery", err)
}

// ResetEvasionPreference clears the auto-promoted protocol preference so that
// subscription links revert to their default ordering.
func (a *ApiService) ResetEvasionPreference(c *gin.Context) {
	err := service.ResetEvasionPreference()
	jsonMsg(c, "evasion", err)
}

// ReportTelemetry accepts a client-submitted connectivity report and persists
// it as a ClientTelemetry row.  This endpoint is intentionally unauthenticated
// so that proxy clients can report even when the admin session has expired.
//
// Expected JSON body:
//
//	{ "protocol": "vless-reality", "success": true, "latency": 120, "throttled": false }
func (a *ApiService) ReportTelemetry(c *gin.Context) {
	var req struct {
		Protocol  string `json:"protocol"`
		Success   bool   `json:"success"`
		LatencyMs int    `json:"latency"`
		Throttled bool   `json:"throttled"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		jsonMsg(c, "", err)
		return
	}
	if req.Protocol == "" {
		jsonMsg(c, "", common.NewError("protocol is required"))
		return
	}
	err := service.RecordTelemetry(model.ClientTelemetry{
		DateTime:  time.Now().Unix(),
		Protocol:  req.Protocol,
		Success:   req.Success,
		LatencyMs: req.LatencyMs,
		Throttled: req.Throttled,
		ClientIP:  getRemoteIp(c),
		Source:    "client",
	})
	jsonMsg(c, "telemetry", err)
}

// GetTelemetryStats returns aggregated per-protocol success/failure rates over
// the last hour for display on the dashboard.
func (a *ApiService) GetTelemetryStats(c *gin.Context) {
	stats, err := service.GetTelemetryStats()
	if err != nil {
		jsonMsg(c, "", err)
		return
	}
	jsonObj(c, stats, nil)
}

// GetOfflineBundle generates and serves a ZIP archive containing pre-rendered
// subscription content for all enabled clients.  Users can download this bundle
// before a blackout and import the proxy configs directly without fetching a
// live subscription URL.
func (a *ApiService) GetOfflineBundle(c *gin.Context) {
	clients, err := a.ClientService.GetAll()
	if err != nil {
		jsonMsg(c, "", err)
		return
	}

	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)

	readme := "AetherProxy Offline Bundle\n" +
		"==========================\n\n" +
		"Each .txt file in this archive contains Base64-encoded proxy URIs for\n" +
		"one client.  Import the file into your proxy client (e.g. v2rayNG,\n" +
		"NekoBox, sing-box) using the 'Import from clipboard' option after\n" +
		"decoding the Base64 content, or use the file directly if your client\n" +
		"supports Base64-encoded subscription files.\n\n" +
		"Generated: " + time.Now().UTC().Format(time.RFC3339) + "\n"
	if f, werr := zw.Create("README.txt"); werr == nil {
		_, _ = f.Write([]byte(readme))
	}

	for _, client := range *clients {
		if !client.Enable {
			continue
		}
		if client.Links == nil {
			continue
		}
		// Decode the stored links array: [{tag: uri}, ...]
		var linksArr []map[string]string
		var uris []string
		if json.Unmarshal(client.Links, &linksArr) == nil {
			for _, m := range linksArr {
				for _, v := range m {
					if v != "" {
						uris = append(uris, v)
					}
				}
			}
		}
		if len(uris) == 0 {
			continue
		}
		// Build Base64 subscription content (standard format).
		raw := strings.Join(uris, "\n")
		encoded := base64.StdEncoding.EncodeToString([]byte(raw))

		fname := sanitizeFilename(client.Name) + "_subscription.txt"
		if f, werr := zw.Create(fname); werr == nil {
			_, _ = f.Write([]byte(encoded))
		}
	}

	if err := zw.Close(); err != nil {
		jsonMsg(c, "", err)
		return
	}

	ts := time.Now().Format("20060102-150405")
	c.Header("Content-Type", "application/zip")
	c.Header("Content-Disposition", "attachment; filename=aetherproxy-offline-"+ts+".zip")
	_, _ = c.Writer.Write(buf.Bytes())
}

// sanitizeFilename replaces characters unsafe for filenames with underscores.
func sanitizeFilename(name string) string {
	var b strings.Builder
	for _, r := range name {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '-' || r == '_' {
			b.WriteRune(r)
		} else {
			b.WriteRune('_')
		}
	}
	s := b.String()
	if s == "" {
		return "client"
	}
	return s
}
