package database

import (
	"encoding/json"
	"os"
	"path"
	"strings"
	"time"

	"github.com/aetherproxy/backend/config"
	"github.com/aetherproxy/backend/database/model"

	"gorm.io/driver/postgres"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

var db *gorm.DB

func initUser() error {
	var count int64
	err := db.Model(&model.User{}).Count(&count).Error
	if err != nil {
		return err
	}
	if count == 0 {
		user := &model.User{
			Username: "admin",
			Password: "admin",
		}
		return db.Create(user).Error
	}
	return nil
}

func openSQLite(dbPath string, gormCfg *gorm.Config) error {
	dir := path.Dir(dbPath)
	err := os.MkdirAll(dir, 01740)
	if err != nil {
		return err
	}
	sep := "?"
	if strings.Contains(dbPath, "?") {
		sep = "&"
	}
	dsn := dbPath + sep + "_busy_timeout=10000&_journal_mode=WAL"
	db, err = gorm.Open(sqlite.Open(dsn), gormCfg)
	return err
}

func openPostgres(dsn string, gormCfg *gorm.Config) error {
	var err error
	db, err = gorm.Open(postgres.Open(dsn), gormCfg)
	return err
}

// OpenDB opens the database. If AETHER_DB_DSN is set it is used as a GORM DSN
// (supports both SQLite file paths and PostgreSQL connection strings
// starting with "postgres://" or "host=").
// For backward-compat the legacy dbPath argument is used when AETHER_DB_DSN is empty.
func OpenDB(dbPath string) error {
	var gormLogger logger.Interface
	if config.IsDebug() {
		gormLogger = logger.Default
	} else {
		gormLogger = logger.Discard
	}
	gormCfg := &gorm.Config{Logger: gormLogger}

	// Prefer AETHER_DB_DSN when set
	dsn := config.GetDBDSN()
	var err error
	if dsn != "" && (strings.HasPrefix(dsn, "postgres://") || strings.HasPrefix(dsn, "host=")) {
		err = openPostgres(dsn, gormCfg)
	} else if dsn != "" {
		// Treat as SQLite file path
		err = openSQLite(dsn, gormCfg)
	} else {
		err = openSQLite(dbPath, gormCfg)
	}
	if err != nil {
		return err
	}

	sqlDB, err := db.DB()
	if err != nil {
		return err
	}
	sqlDB.SetMaxOpenConns(25)
	sqlDB.SetMaxIdleConns(5)
	sqlDB.SetConnMaxLifetime(time.Hour)

	if config.IsDebug() {
		db = db.Debug()
	}
	return nil
}

func InitDB(dbPath string) error {
	err := OpenDB(dbPath)
	if err != nil {
		return err
	}

	// Default Outbounds
	if !db.Migrator().HasTable(&model.Outbound{}) {
		_ = db.Migrator().CreateTable(&model.Outbound{})
		defaultOutbound := []model.Outbound{
			{Type: "direct", Tag: "direct", Options: json.RawMessage(`{}`)},
		}
		db.Create(&defaultOutbound)
	}

	err = Migrate()
	if err != nil {
		return err
	}
	err = initUser()
	if err != nil {
		return err
	}

	return nil
}

func GetDB() *gorm.DB {
	return db
}

func IsNotFound(err error) bool {
	return err == gorm.ErrRecordNotFound
}
