package sub

import (
	"github.com/aetherproxy/backend/logger"
	"github.com/aetherproxy/backend/service"

	qrcode "github.com/skip2/go-qrcode"

	"github.com/gin-gonic/gin"
)

type SubHandler struct {
	service.SettingService
	SubService
	JsonService
	ClashService
}

func NewSubHandler(g *gin.RouterGroup) {
	a := &SubHandler{}
	a.initRouter(g)
}

func (s *SubHandler) initRouter(g *gin.RouterGroup) {
	g.GET("/:subid", s.subs)
	g.HEAD("/:subid", s.subHeaders)
	g.GET("/qr/:subid", s.subQR)
}

func (s *SubHandler) subs(c *gin.Context) {
	var headers []string
	var result *string
	var err error
	subId := c.Param("subid")
	format, isFormat := c.GetQuery("format")
	if isFormat {
		switch format {
		case "json":
			result, headers, err = s.JsonService.GetJson(subId, format)
		case "clash":
			result, headers, err = s.ClashService.GetClash(subId)
		}
		if err != nil || result == nil {
			logger.Error(err)
			c.String(400, "Error!")
			return
		}
	} else {
		result, headers, err = s.SubService.GetSubs(subId)
		if err != nil || result == nil {
			logger.Error(err)
			c.String(400, "Error!")
			return
		}
	}

	s.addHeaders(c, headers)

	c.String(200, *result)
}

func (s *SubHandler) subHeaders(c *gin.Context) {
	subId := c.Param("subid")
	client, err := s.SubService.getClientBySubId(subId)
	if err != nil {
		logger.Error(err)
		c.String(400, "Error!")
		return
	}

	headers := s.SubService.getClientHeaders(client)
	s.addHeaders(c, headers)

	c.Status(200)
}

// subQR serves the subscription URL as a QR code PNG image.
// The QR code encodes the URL a client would use to import the subscription.
// Example: GET /sub/qr/<subid>
func (s *SubHandler) subQR(c *gin.Context) {
	subId := c.Param("subid")

	// Build the subscription URL using the request host
	scheme := "https"
	if c.Request.TLS == nil {
		scheme = "http"
	}
	subURL := scheme + "://" + c.Request.Host + "/sub/" + subId

	png, err := qrcode.Encode(subURL, qrcode.Medium, 256)
	if err != nil {
		logger.Error("subQR encode:", err)
		c.String(500, "QR generation failed")
		return
	}

	c.Header("Cache-Control", "no-store")
	c.Data(200, "image/png", png)
}

func (s *SubHandler) addHeaders(c *gin.Context, headers []string) {
	c.Writer.Header().Set("Subscription-Userinfo", headers[0])
	c.Writer.Header().Set("Profile-Update-Interval", headers[1])
	c.Writer.Header().Set("Profile-Title", headers[2])
}
