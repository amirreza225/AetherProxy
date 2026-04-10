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
		a.Save(c, username)
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
		a.ReloadTokens()
	case "deleteToken":
		a.DeleteToken(c)
		a.ReloadTokens()
	case "createNode":
		a.CreateNode(c)
	case "updateNode":
		a.UpdateNode(c)
	case "deleteNode":
		a.DeleteNode(c)
	case "deployNode":
		a.DeployNode(c)
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
	default:
		jsonMsg(c, "failed", common.NewError("unknown action: ", action))
	}
}

func (a *APIv2Handler) getHandler(c *gin.Context) {
	action := c.Param("getAction")

	switch action {
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
	case "checkOutbound":
		a.GetCheckOutbound(c)
	case "tokens":
		a.GetTokens(c)
	case "singbox-config":
		a.GetSingboxConfig(c)
	case "nodes":
		a.GetNodes(c)
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
	tokens, err := a.LoadTokens()
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
