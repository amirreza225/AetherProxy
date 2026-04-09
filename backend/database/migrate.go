// Package database – migrate.go
// Provides an explicit, idempotent AutoMigrate wrapper that can be called from
// migration tooling independently of the full InitDB bootstrap path.
package database

import (
	"github.com/aetherproxy/backend/database/model"
)

// Migrate runs GORM AutoMigrate for every AetherProxy model.
// It is idempotent: safe to call repeatedly and on both SQLite and PostgreSQL.
// The database connection must be opened via OpenDB or InitDB before calling Migrate.
func Migrate() error {
	return db.AutoMigrate(
		&model.Setting{},
		&model.Tls{},
		&model.Inbound{},
		&model.Outbound{},
		&model.Service{},
		&model.Endpoint{},
		&model.User{},
		&model.Tokens{},
		&model.Stats{},
		&model.Client{},
		&model.Changes{},
		&model.Node{},
		&model.EvasionEvent{},
	)
}
