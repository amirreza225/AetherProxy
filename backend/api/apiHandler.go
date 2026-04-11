package api

import (
	"strings"

	"github.com/aetherproxy/backend/util/common"

	"github.com/gin-gonic/gin"
)

type APIHandler struct {
	ApiService
	apiv2 *APIv2Handler
}

func NewAPIHandler(g *gin.RouterGroup, a2 *APIv2Handler) {
	a := &APIHandler{
		apiv2: a2,
	}
	a.initRouter(g)
}

func (a *APIHandler) initRouter(g *gin.RouterGroup) {
	g.Use(func(c *gin.Context) {
		path := c.Request.URL.Path
		if !strings.HasSuffix(path, "login") && !strings.HasSuffix(path, "logout") {
			checkLogin(c)
		}
	})
	g.POST("/:postAction", a.postHandler)
	g.GET("/:getAction", a.getHandler)
}

func (a *APIHandler) postHandler(c *gin.Context) {
	loginUser := GetLoginUser(c)
	action := c.Param("postAction")

	switch action {
	case "login":
		if !checkLoginRateLimit(c) {
			return
		}
		a.Login(c)
	case "changePass":
		a.ChangePass(c)
	case "save":
		a.Save(c, loginUser)
	case "restartApp":
		a.RestartApp(c)
	case "restartSb":
		a.RestartSb(c)
	case "linkConvert":
		a.LinkConvert(c)
	case "subConvert":
		a.SubConvert(c)
	case "importdb":
		a.ImportDb(c)
	case "addToken":
		a.AddToken(c)
		a.apiv2.ReloadTokens()
	case "deleteToken":
		a.DeleteToken(c)
		a.apiv2.ReloadTokens()
	case "createNode":
		a.CreateNode(c)
	case "updateNode":
		a.UpdateNode(c)
	case "deleteNode":
		a.DeleteNode(c)
	case "deployNode":
		a.DeployNode(c)
	case "portsyncSync":
		a.TriggerPortSync(c)
	case "portsyncRetry":
		a.RetryPortSync(c)
	case "portsyncClear":
		a.ClearPortSync(c)
	case "saveRouting":
		a.SaveRouting(c)
	case "setPluginEnabled":
		a.SetPluginEnabled(c)
	case "setPluginConfig":
		a.SetPluginConfig(c)
	case "discoveryJoin":
		a.DiscoveryJoin(c)
	case "discoveryLeave":
		a.DiscoveryLeave(c)
	case "discoveryAddPeer":
		a.DiscoveryAddPeer(c)
	case "issueCert":
		a.IssueCert(c)
	case "saveCert":
		a.SaveCert(c)
	default:
		jsonMsg(c, "failed", common.NewError("unknown action: ", action))
	}
}

func (a *APIHandler) getHandler(c *gin.Context) {
	action := c.Param("getAction")

	switch action {
	case "logout":
		a.Logout(c)
	case "load":
		a.LoadData(c)
	case "inbounds", "outbounds", "endpoints", "services", "tls", "clients", "config":
		err := a.LoadPartialData(c, []string{action})
		if err != nil {
			jsonMsg(c, action, err)
		}
		return
	case "users":
		a.GetUsers(c)
	case "settings":
		a.GetSettings(c)
	case "stats":
		a.GetStats(c)
	case "status":
		a.GetStatus(c)
	case "onlines":
		a.GetOnlines(c)
	case "logs":
		a.GetLogs(c)
	case "changes":
		a.CheckChanges(c)
	case "keypairs":
		a.GetKeypairs(c)
	case "getdb":
		a.GetDb(c)
	case "tokens":
		a.GetTokens(c)
	case "singbox-config":
		a.GetSingboxConfig(c)
	case "checkOutbound":
		a.GetCheckOutbound(c)
	case "nodes":
		a.GetNodes(c)
	case "portsyncStatus":
		a.GetPortSyncStatus(c)
	case "routing":
		a.GetRouting(c)
	case "analytics":
		a.GetAnalytics(c)
	case "plugins":
		a.GetPlugins(c)
	case "discoveryStatus":
		a.GetDiscoveryStatus(c)
	case "discoveryPeers":
		a.GetDiscoveryPeers(c)
	default:
		jsonMsg(c, "failed", common.NewError("unknown action: ", action))
	}
}
