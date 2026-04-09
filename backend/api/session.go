package api

import (
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/aetherproxy/backend/config"
	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
)

const jwtContextKey = "_aether_jwt_token"

type aetherClaims struct {
	Username string `json:"username"`
	jwt.RegisteredClaims
}

func issueJWT(username string, maxAgeMinutes int) (string, error) {
	exp := time.Now().Add(24 * time.Hour)
	if maxAgeMinutes > 0 {
		exp = time.Now().Add(time.Duration(maxAgeMinutes) * time.Minute)
	}
	claims := aetherClaims{
		Username: username,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(exp),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
	}
	t := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return t.SignedString([]byte(config.GetJWTSecret()))
}

func validateJWT(tokenStr string) (string, error) {
	t, err := jwt.ParseWithClaims(tokenStr, &aetherClaims{}, func(t *jwt.Token) (interface{}, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, errors.New("unexpected signing method")
		}
		return []byte(config.GetJWTSecret()), nil
	})
	if err != nil || !t.Valid {
		return "", errors.New("invalid token")
	}
	claims, ok := t.Claims.(*aetherClaims)
	if !ok {
		return "", errors.New("invalid claims")
	}
	return claims.Username, nil
}

// SetLoginUser issues a JWT, stores it in the gin context (for the Login response),
// and sets it as an httpOnly cookie for browser-based clients.
func SetLoginUser(c *gin.Context, userName string, maxAge int) error {
	tokenStr, err := issueJWT(userName, maxAge)
	if err != nil {
		return err
	}
	c.Set(jwtContextKey, tokenStr)
	maxAgeSec := 86400
	if maxAge > 0 {
		maxAgeSec = maxAge * 60
	}
	http.SetCookie(c.Writer, &http.Cookie{
		Name:     "aether_token",
		Value:    tokenStr,
		MaxAge:   maxAgeSec,
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
	})
	return nil
}

// GetLoginUser extracts the authenticated username from the JWT.
// It checks the Authorization: Bearer header first, then the aether_token cookie.
func GetLoginUser(c *gin.Context) string {
	tokenStr := ""
	if h := c.GetHeader("Authorization"); strings.HasPrefix(h, "Bearer ") {
		tokenStr = strings.TrimPrefix(h, "Bearer ")
	}
	if tokenStr == "" {
		if cookie, err := c.Cookie("aether_token"); err == nil {
			tokenStr = cookie
		}
	}
	if tokenStr == "" {
		return ""
	}
	username, err := validateJWT(tokenStr)
	if err != nil {
		return ""
	}
	return username
}

func IsLogin(c *gin.Context) bool {
	return GetLoginUser(c) != ""
}

// ClearSession expires the auth cookie.
func ClearSession(c *gin.Context) {
	http.SetCookie(c.Writer, &http.Cookie{
		Name:     "aether_token",
		Value:    "",
		MaxAge:   -1,
		Path:     "/",
		HttpOnly: true,
	})
}

// GetIssuedToken returns the JWT that was just issued during this request (used in Login response).
func GetIssuedToken(c *gin.Context) string {
	v, _ := c.Get(jwtContextKey)
	s, _ := v.(string)
	return s
}
