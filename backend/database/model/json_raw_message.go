package model

import (
	"database/sql/driver"
	"encoding/json"
	"fmt"
)

// JSONRawMessage behaves like json.RawMessage but also supports scanning
// from database drivers that return text columns as string.
type JSONRawMessage json.RawMessage

func (m JSONRawMessage) MarshalJSON() ([]byte, error) {
	if m == nil {
		return []byte("null"), nil
	}
	return []byte(m), nil
}

func (m *JSONRawMessage) UnmarshalJSON(data []byte) error {
	if m == nil {
		return fmt.Errorf("JSONRawMessage: UnmarshalJSON on nil pointer")
	}
	*m = append((*m)[:0], data...)
	return nil
}

func (m JSONRawMessage) Value() (driver.Value, error) {
	if len(m) == 0 {
		return nil, nil
	}
	return string(m), nil
}

func (m *JSONRawMessage) Scan(value interface{}) error {
	if m == nil {
		return fmt.Errorf("JSONRawMessage: Scan on nil pointer")
	}
	switch v := value.(type) {
	case nil:
		*m = nil
		return nil
	case []byte:
		*m = append((*m)[:0], v...)
		return nil
	case string:
		*m = append((*m)[:0], v...)
		return nil
	default:
		return fmt.Errorf("JSONRawMessage: unsupported Scan type %T", value)
	}
}
