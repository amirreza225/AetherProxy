package sub

import (
	"encoding/base64"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/aetherproxy/backend/database"
	"github.com/aetherproxy/backend/database/model"
	"github.com/aetherproxy/backend/service"
	"github.com/aetherproxy/backend/util"
)

// offlineNodeCache caches the set of offline node host strings with a TTL
// matching the node health-check interval (30 s).  This avoids a DB query
// on every subscription request.
var (
	offlineNodeCacheMu      sync.RWMutex
	offlineNodeCacheHosts   map[string]struct{}
	offlineNodeCacheExpires time.Time
)

const offlineNodeCacheTTL = 30 * time.Second

type SubService struct {
	service.SettingService
	LinkService
}

func (s *SubService) GetSubs(subId string) (*string, []string, error) {
	var err error

	client, err := s.getClientBySubId(subId)
	if err != nil {
		return nil, nil, err
	}

	clientInfo := ""
	subShowInfo, _ := s.GetSubShowInfo()
	if subShowInfo {
		clientInfo = s.getClientInfo(client)
	}

	linksArray := s.GetLinks(&client.Links, "all", clientInfo)
	linksArray = filterOfflineNodes(linksArray)
	result := strings.Join(linksArray, "\n")

	headers := s.getClientHeaders(client)

	subEncode, _ := s.GetSubEncode()
	if subEncode {
		result = base64.StdEncoding.EncodeToString([]byte(result))
	}

	return &result, headers, nil
}

// filterOfflineNodes removes any proxy URI whose host matches a node that is
// currently marked "offline" in the nodes table. This implements the Phase 2
// failover requirement: unhealthy nodes are excluded from subscription output.
func filterOfflineNodes(links []string) []string {
	offlineHosts := getOfflineNodeHosts()
	if len(offlineHosts) == 0 {
		return links
	}
	// Pre-compute the search strings for each offline host so they are not
	// re-allocated on every (link × host) iteration.
	type hostPatterns struct{ atHost, slashHost string }
	patterns := make([]hostPatterns, 0, len(offlineHosts))
	for host := range offlineHosts {
		patterns = append(patterns, hostPatterns{
			atHost:    "@" + host + ":",
			slashHost: "//" + host + ":",
		})
	}

	result := make([]string, 0, len(links))
	for _, link := range links {
		excluded := false
		for _, p := range patterns {
			if strings.Contains(link, p.atHost) || strings.Contains(link, p.slashHost) {
				excluded = true
				break
			}
		}
		if !excluded {
			result = append(result, link)
		}
	}
	return result
}

// getOfflineNodeHosts returns a set of host IPs/domains for all offline nodes.
// Results are cached for offlineNodeCacheTTL to avoid a DB hit on every
// subscription request.
func getOfflineNodeHosts() map[string]struct{} {
	now := time.Now()

	// Fast path: check cache under read lock.
	offlineNodeCacheMu.RLock()
	if offlineNodeCacheHosts != nil && now.Before(offlineNodeCacheExpires) {
		hosts := offlineNodeCacheHosts
		offlineNodeCacheMu.RUnlock()
		return hosts
	}
	offlineNodeCacheMu.RUnlock()

	// Slow path: fetch from DB and refresh cache.
	db := database.GetDB()
	var nodes []model.Node
	if err := db.Where("status = ?", "offline").Find(&nodes).Error; err != nil {
		return nil
	}
	m := make(map[string]struct{}, len(nodes))
	for _, n := range nodes {
		if n.Host != "" {
			m[n.Host] = struct{}{}
		}
	}

	offlineNodeCacheMu.Lock()
	offlineNodeCacheHosts = m
	offlineNodeCacheExpires = now.Add(offlineNodeCacheTTL)
	offlineNodeCacheMu.Unlock()

	return m
}

func (j *SubService) getClientBySubId(subId string) (*model.Client, error) {
	db := database.GetDB()
	client := &model.Client{}
	err := db.Model(model.Client{}).Where("enable = true and name = ?", subId).First(client).Error
	if err != nil {
		return nil, err
	}
	return client, nil
}

func (s *SubService) getClientHeaders(client *model.Client) []string {
	updateInterval, _ := s.GetSubUpdates()
	return util.GetHeaders(client, updateInterval)
}

func (s *SubService) getClientInfo(c *model.Client) string {
	now := time.Now().Unix()

	var result []string
	if vol := c.Volume - (c.Up + c.Down); vol > 0 {
		result = append(result, fmt.Sprintf("%s%s", s.formatTraffic(vol), "📊"))
	}
	if c.Expiry > 0 {
		result = append(result, fmt.Sprintf("%d%s⏳", (c.Expiry-now)/86400, "Days"))
	}
	if len(result) > 0 {
		return " " + strings.Join(result, " ")
	} else {
		return " ♾"
	}
}

func (s *SubService) formatTraffic(trafficBytes int64) string {
	if trafficBytes < 1024 {
		return fmt.Sprintf("%.2fB", float64(trafficBytes)/float64(1))
	} else if trafficBytes < (1024 * 1024) {
		return fmt.Sprintf("%.2fKB", float64(trafficBytes)/float64(1024))
	} else if trafficBytes < (1024 * 1024 * 1024) {
		return fmt.Sprintf("%.2fMB", float64(trafficBytes)/float64(1024*1024))
	} else if trafficBytes < (1024 * 1024 * 1024 * 1024) {
		return fmt.Sprintf("%.2fGB", float64(trafficBytes)/float64(1024*1024*1024))
	} else if trafficBytes < (1024 * 1024 * 1024 * 1024 * 1024) {
		return fmt.Sprintf("%.2fTB", float64(trafficBytes)/float64(1024*1024*1024*1024))
	} else {
		return fmt.Sprintf("%.2fEB", float64(trafficBytes)/float64(1024*1024*1024*1024*1024))
	}
}
