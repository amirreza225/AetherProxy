package api

import (
	"encoding/json"
	"time"

	"github.com/aetherproxy/backend/logger"
	"github.com/aetherproxy/backend/util/common"

	"github.com/gin-gonic/gin"
)

type TokenInMemory struct {
	Token    string
	Expiry   int64
	Username string
}

type APIv2Handler struct {
	ApiService
	tokens *[]TokenInMemory
}

func NewAPIv2Handler(g *gin.RouterGroup) *APIv2Handler {
	a := &APIv2Handler{}
	a.ReloadTokens()
	a.initRouter(g)
	return a
}

func (a *APIv2Handler) initRouter(g *gin.RouterGroup) {
	g.Use(func(c *gin.Context) {
		a.checkToken(c)
	})
	g.POST("/:postAction", a.postHandler)
	g.GET("/:getAction", a.getHandler)
}

func (a *APIv2Handler) postHandler(c *gin.Context) {
	username := a.findUsername(c)
	action := c.Param("postAction")

	switch action {
	case "save":
		a.ApiService.Save(c, username)
	case "restartApp":
		a.ApiService.RestartApp(c)
	case "restartSb":
		a.ApiService.RestartSb(c)
	case "linkConvert":
		a.ApiService.LinkConvert(c)
	case "subConvert":
		a.ApiService.SubConvert(c)
	case "importdb":
		a.ApiService.ImportDb(c)
	case "addToken":
		a.ApiService.AddToken(c)
		a.ReloadTokens()
	case "deleteToken":
		a.ApiService.DeleteToken(c)
		a.ReloadTokens()
	case "createNode":
		a.ApiService.CreateNode(c)
	case "updateNode":
		a.ApiService.UpdateNode(c)
	case "deleteNode":
		a.ApiService.DeleteNode(c)
	case "deployNode":
		a.ApiService.DeployNode(c)
	case "saveRouting":
		a.ApiService.SaveRouting(c)
	case "setPluginEnabled":
		a.ApiService.SetPluginEnabled(c)
	case "setPluginConfig":
		a.ApiService.SetPluginConfig(c)
	case "discoveryJoin":
		a.ApiService.DiscoveryJoin(c)
	case "discoveryLeave":
		a.ApiService.DiscoveryLeave(c)
	case "discoveryAddPeer":
		a.ApiService.DiscoveryAddPeer(c)
	default:
		jsonMsg(c, "failed", common.NewError("unknown action: ", action))
	}
}

func (a *APIv2Handler) getHandler(c *gin.Context) {
	action := c.Param("getAction")

	switch action {
	case "load":
		a.ApiService.LoadData(c)
	case "inbounds", "outbounds", "endpoints", "services", "tls", "clients", "config":
		err := a.ApiService.LoadPartialData(c, []string{action})
		if err != nil {
			jsonMsg(c, action, err)
		}
		return
	case "users":
		a.ApiService.GetUsers(c)
	case "settings":
		a.ApiService.GetSettings(c)
	case "stats":
		a.ApiService.GetStats(c)
	case "status":
		a.ApiService.GetStatus(c)
	case "onlines":
		a.ApiService.GetOnlines(c)
	case "logs":
		a.ApiService.GetLogs(c)
	case "changes":
		a.ApiService.CheckChanges(c)
	case "keypairs":
		a.ApiService.GetKeypairs(c)
	case "getdb":
		a.ApiService.GetDb(c)
	case "checkOutbound":
		a.ApiService.GetCheckOutbound(c)
	case "tokens":
		a.ApiService.GetTokens(c)
	case "singbox-config":
		a.ApiService.GetSingboxConfig(c)
	case "nodes":
		a.ApiService.GetNodes(c)
	case "routing":
		a.ApiService.GetRouting(c)
	case "analytics":
		a.ApiService.GetAnalytics(c)
	case "plugins":
		a.ApiService.GetPlugins(c)
	case "discoveryStatus":
		a.ApiService.GetDiscoveryStatus(c)
	case "discoveryPeers":
		a.ApiService.GetDiscoveryPeers(c)
	default:
		jsonMsg(c, "failed", common.NewError("unknown action: ", action))
	}
}

func (a *APIv2Handler) findUsername(c *gin.Context) string {
	token := c.Request.Header.Get("Token")
	for index, t := range *a.tokens {
		if t.Expiry > 0 && t.Expiry < time.Now().Unix() {
			(*a.tokens) = append((*a.tokens)[:index], (*a.tokens)[index+1:]...)
			continue
		}
		if t.Token == token {
			return t.Username
		}
	}
	return ""
}

func (a *APIv2Handler) checkToken(c *gin.Context) {
	username := a.findUsername(c)
	if username != "" {
		c.Set(v2UsernameKey, username)
		c.Next()
		return
	}
	jsonMsg(c, "", common.NewError("invalid token"))
	c.Abort()
}

func (a *APIv2Handler) ReloadTokens() {
	tokens, err := a.ApiService.LoadTokens()
	if err == nil {
		var newTokens []TokenInMemory
		err = json.Unmarshal(tokens, &newTokens)
		if err != nil {
			logger.Error("unable to load tokens: ", err)
		}
		a.tokens = &newTokens
	} else {
		logger.Error("unable to load tokens: ", err)
	}
}
