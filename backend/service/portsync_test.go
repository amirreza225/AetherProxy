package service

import "testing"

func TestRuleFromComment(t *testing.T) {
	rule, ok := ruleFromComment("aetherproxy:tcp:443")
	if !ok {
		t.Fatal("expected valid managed comment")
	}
	if rule.Port != 443 || rule.Proto != "tcp" {
		t.Fatalf("unexpected rule parsed: %+v", rule)
	}

	if _, ok := ruleFromComment("manual:tcp:443"); ok {
		t.Fatal("expected non-managed comment to be ignored")
	}
	if _, ok := ruleFromComment("aetherproxy:icmp:8"); ok {
		t.Fatal("expected unsupported protocol to be rejected")
	}
}

func TestParseManagedUFWRules(t *testing.T) {
	status := `Status: active

[ 1] 22/tcp                     ALLOW IN    Anywhere
[ 2] 443/tcp                    ALLOW IN    Anywhere                   # aetherproxy:tcp:443
[ 3] 443/tcp (v6)               ALLOW IN    Anywhere (v6)              # aetherproxy:tcp:443
[ 4] 8443/udp                   ALLOW IN    Anywhere                   # aetherproxy:udp:8443`

	rules := parseManagedUFWRules(status)
	if len(rules) != 3 {
		t.Fatalf("expected 3 managed rules, got %d", len(rules))
	}
	if rules[0].Number != 2 || rules[0].Rule.key() != "tcp:443" {
		t.Fatalf("unexpected first rule: %+v", rules[0])
	}
	if rules[2].Number != 4 || rules[2].Rule.key() != "udp:8443" {
		t.Fatalf("unexpected last rule: %+v", rules[2])
	}
}

func TestInferInboundProtocols(t *testing.T) {
	if got := inferInboundProtocols("hysteria2", map[string]interface{}{}); len(got) != 1 || got[0] != "udp" {
		t.Fatalf("expected udp for hysteria2, got %#v", got)
	}
	if got := inferInboundProtocols("vless", map[string]interface{}{}); len(got) != 1 || got[0] != "tcp" {
		t.Fatalf("expected tcp for vless, got %#v", got)
	}
	got := inferInboundProtocols("vless", map[string]interface{}{"network": "tcp,udp"})
	if len(got) != 2 || got[0] != "tcp" || got[1] != "udp" {
		t.Fatalf("expected network override to tcp+udp, got %#v", got)
	}
}

func TestDiffRules(t *testing.T) {
	existing := []managedUFWRule{
		{Number: 2, Rule: portRule{Port: 443, Proto: "tcp"}},
		{Number: 5, Rule: portRule{Port: 8443, Proto: "udp"}},
	}
	desired := []portRule{
		{Port: 443, Proto: "tcp"},
		{Port: 9000, Proto: "tcp"},
	}

	toDelete, toAdd := diffRules(existing, desired)
	if len(toDelete) != 1 || toDelete[0] != 5 {
		t.Fatalf("unexpected delete list: %#v", toDelete)
	}
	if len(toAdd) != 1 || toAdd[0].key() != "tcp:9000" {
		t.Fatalf("unexpected add list: %#v", toAdd)
	}
}
