package sub

import (
	"net/http"

	"github.com/aetherproxy/backend/database"
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
			result, headers, err = s.GetJson(subId, format)
		case "clash":
			result, headers, err = s.GetClash(subId)
		}
		if err != nil || result == nil {
			if database.IsNotFound(err) {
				c.String(http.StatusNotFound, "Not Found")
				return
			}
			logger.Errorf("subs failed subid=%q format=%q err=%v", subId, format, err)
			c.String(http.StatusBadRequest, "Error!")
			return
		}
	} else {
		result, headers, err = s.GetSubs(subId)
		if err != nil || result == nil {
			if database.IsNotFound(err) {
				c.String(http.StatusNotFound, "Not Found")
				return
			}
			logger.Errorf("subs failed subid=%q err=%v", subId, err)
			c.String(http.StatusBadRequest, "Error!")
			return
		}
	}

	s.addHeaders(c, headers)

	c.String(200, *result)
}

func (s *SubHandler) subHeaders(c *gin.Context) {
	subId := c.Param("subid")
	client, err := s.getClientBySubId(subId)
	if err != nil {
		if database.IsNotFound(err) {
			c.String(http.StatusNotFound, "Not Found")
			return
		}
		logger.Errorf("sub headers failed subid=%q err=%v", subId, err)
		c.String(http.StatusBadRequest, "Error!")
		return
	}

	headers := s.getClientHeaders(client)
	s.addHeaders(c, headers)

	c.Status(200)
}

// subQR serves the subscription URL as a QR code PNG image.
// The QR code encodes the URL a client would use to import the subscription.
// Example: GET /sub/qr/<subid>
// Optional: GET /sub/qr/<subid>?format=clash  or  ?format=json
func (s *SubHandler) subQR(c *gin.Context) {
	subId := c.Param("subid")

	// Build the subscription URL using the request host
	scheme := "https"
	if c.Request.TLS == nil {
		scheme = "http"
	}
	subURL := scheme + "://" + c.Request.Host + "/sub/" + subId
	if format, ok := c.GetQuery("format"); ok && format != "" {
		subURL += "?format=" + format
	}

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
