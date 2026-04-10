package service

import (
	"encoding/json"
	"fmt"

	"github.com/aetherproxy/backend/database"
)

// RouteRule maps to a sing-box route.rules entry.
// Only the fields used by the visual editor are included; additional fields
// can be added without breaking serialization.
type RouteRule struct {
	Inbound      []string `json:"inbound,omitempty"`
	Network      string   `json:"network,omitempty"`
	DomainSuffix []string `json:"domain_suffix,omitempty"`
	GeoIP        []string `json:"geoip,omitempty"`
	Outbound     string   `json:"outbound,omitempty"`
	Action       string   `json:"action,omitempty"`
}

// RoutingService reads and writes the route.rules section of the stored
// sing-box config (the "config" setting key persisted by SettingService).
type RoutingService struct {
	SettingService
	ConfigService
}

// GetRules returns the current route rules from the stored config.
func (s *RoutingService) GetRules() ([]RouteRule, error) {
	raw, err := s.SettingService.GetConfig()
	if err != nil {
		return nil, err
	}

	var cfg struct {
		Route struct {
			Rules []RouteRule `json:"rules"`
		} `json:"route"`
	}
	if err := json.Unmarshal([]byte(raw), &cfg); err != nil {
		return nil, fmt.Errorf("parse config: %w", err)
	}
	return cfg.Route.Rules, nil
}

// SaveRules replaces the route.rules array in the stored config and
// hot-reloads sing-box.
func (s *RoutingService) SaveRules(rules []RouteRule) error {
	raw, err := s.SettingService.GetConfig()
	if err != nil {
		return err
	}

	var cfg map[string]json.RawMessage
	if err := json.Unmarshal([]byte(raw), &cfg); err != nil {
		return fmt.Errorf("parse config: %w", err)
	}

	// Read existing route section
	var route map[string]json.RawMessage
	if routeRaw, ok := cfg["route"]; ok {
		if err := json.Unmarshal(routeRaw, &route); err != nil {
			return fmt.Errorf("parse route: %w", err)
		}
	} else {
		route = make(map[string]json.RawMessage)
	}

	// Replace rules
	rulesJSON, err := json.Marshal(rules)
	if err != nil {
		return err
	}
	route["rules"] = rulesJSON

	routeJSON, err := json.Marshal(route)
	if err != nil {
		return err
	}
	cfg["route"] = routeJSON

	newConfig, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}

	// Persist via SettingService
	db := database.GetDB()
	tx := db.Begin()
	if err := s.SaveConfig(tx, newConfig); err != nil {
		tx.Rollback()
		return err
	}
	tx.Commit()

	// Async restart so the HTTP handler returns quickly
	go func() { _ = s.restartCoreWithConfig(newConfig) }()
	return nil
}
