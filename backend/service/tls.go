package service

import (
	"encoding/json"

	"github.com/aetherproxy/backend/database"
	"github.com/aetherproxy/backend/database/model"
	"github.com/aetherproxy/backend/logger"
	"github.com/aetherproxy/backend/util/common"

	"gorm.io/gorm"
)

type TlsService struct {
	InboundService
	ServicesService
}

func (s *TlsService) GetAll() ([]model.Tls, error) {
	db := database.GetDB()
	tlsConfig := []model.Tls{}
	err := db.Model(model.Tls{}).Scan(&tlsConfig).Error
	if err != nil {
		return nil, err
	}

	return tlsConfig, nil
}

func (s *TlsService) Save(tx *gorm.DB, action string, data json.RawMessage, hostname string) error {
	var err error

	switch action {
	case "new", "edit":
		var tls model.Tls
		err = json.Unmarshal(data, &tls)
		if err != nil {
			return err
		}

		// If the server TLS config specifies "acme_domain", obtain a Let's Encrypt
		// certificate automatically and fill in certificate_path / key_path.
		if err = s.applyACME(&tls); err != nil {
			return err
		}

		err = tx.Save(&tls).Error
		if err != nil {
			return err
		}
		if action == "edit" {
			var inbounds []model.Inbound
			err = tx.Model(model.Inbound{}).Preload("Tls").Where("tls_id = ?", tls.Id).Find(&inbounds).Error
			if err != nil {
				return err
			}
			if len(inbounds) > 0 {
				err = s.UpdateLinksByInboundChange(tx, &inbounds, hostname, "")
				if err != nil {
					return err
				}
				var inboundIds []uint
				for _, inbound := range inbounds {
					inboundIds = append(inboundIds, inbound.Id)
				}
				err = s.UpdateOutJsons(tx, inboundIds, hostname)
				if err != nil {
					return common.NewError("unable to update out_json of inbounds: ", err.Error())
				}
				err = s.RestartInbounds(tx, inboundIds)
				if err != nil {
					return err
				}
			}
			var serviceIds []uint
			err = tx.Model(model.Service{}).Where("tls_id = ?", tls.Id).Scan(&serviceIds).Error
			if err != nil {
				return err
			}
			if len(serviceIds) > 0 {
				err = s.RestartServices(tx, serviceIds)
				if err != nil {
					return err
				}
			}
		}
	case "del":
		var id uint
		err = json.Unmarshal(data, &id)
		if err != nil {
			return err
		}
		var inboundCount int64
		err = tx.Model(model.Inbound{}).Where("tls_id = ?", id).Count(&inboundCount).Error
		if err != nil {
			return err
		}
		var serviceCount int64
		err = tx.Model(model.Service{}).Where("tls_id = ?", id).Count(&serviceCount).Error
		if err != nil {
			return err
		}
		if inboundCount > 0 || serviceCount > 0 {
			return common.NewError("tls in use")
		}
		err = tx.Where("id = ?", id).Delete(model.Tls{}).Error
		if err != nil {
			return err
		}
	}

	return nil
}

// applyACME checks if the TLS server config has an "acme_domain" field.
// If so, it obtains a certificate via Let's Encrypt and rewrites the server JSON
// to use certificate_path / key_path instead, removing acme_domain afterwards.
func (s *TlsService) applyACME(tls *model.Tls) error {
	if len(tls.Server) == 0 {
		return nil
	}

	var serverCfg map[string]interface{}
	if err := json.Unmarshal(tls.Server, &serverCfg); err != nil {
		return err
	}

	domain, _ := serverCfg["acme_domain"].(string)
	if domain == "" {
		return nil
	}

	logger.Infof("TLS: obtaining Let's Encrypt certificate for domain %q", domain)
	var certPath, keyPath string
	var err error
	// Prefer Caddy's existing cert to avoid ACME challenge conflicts.
	if cp, kp := caddyCertPaths(domain); cp != "" {
		certPath, keyPath = cp, kp
	} else {
		certPath, keyPath, err = GetACMEService().ObtainCert(domain)
		if err != nil {
			return common.NewError("ACME certificate failed for "+domain+": ", err.Error())
		}
	}

	delete(serverCfg, "acme_domain")
	serverCfg["certificate_path"] = certPath
	serverCfg["key_path"] = keyPath

	updated, err := json.Marshal(serverCfg)
	if err != nil {
		return err
	}
	tls.Server = model.JSONRawMessage(updated)
	return nil
}
