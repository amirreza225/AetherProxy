package service

import (
	"encoding/json"
	"fmt"

	"github.com/aetherproxy/backend/database"
	"github.com/aetherproxy/backend/logger"
)

// RouteRule is an open map that preserves every sing-box route.rules field
// without restricting it to a fixed struct.  Using map[string]json.RawMessage
// ensures that advanced fields (ip_cidr, rule_set, process_name, invert, …)
// round-trip through the API without being silently dropped.
type RouteRule = map[string]json.RawMessage

// RoutingService reads and writes the route.rules section of the stored
// sing-box config (the "config" setting key persisted by SettingService).
// It intentionally does NOT embed ConfigService to avoid ambiguous method
// promotion when ApiService embeds both RoutingService and ConfigService.
// Core restarts are triggered via the package-level restartCoreAsync helper.
type RoutingService struct {
	SettingService
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
	if err := tx.Commit().Error; err != nil {
		return err
	}

	// Async restart so the HTTP handler returns quickly.
	// Errors are logged inside restartCoreAsync → restartCoreWithConfig.
	restartCoreAsync(newConfig)
	logger.Info("routing rules saved; sing-box restart scheduled")
	return nil
}
