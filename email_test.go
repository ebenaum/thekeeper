package main

import (
	"strings"
	"testing"
)

func TestLoadSMTPConfig(t *testing.T) {
	tests := []struct {
		name    string
		env     map[string]string
		wantErr bool
	}{
		{
			"all vars set",
			map[string]string{
				"SMTP_HOST":     "smtp.example.com",
				"SMTP_PORT":     "587",
				"SMTP_USER":     "user",
				"SMTP_PASSWORD": "pass",
				"SMTP_FROM":     "from@example.com",
			},
			false,
		},
		{
			"missing host",
			map[string]string{
				"SMTP_PORT":     "587",
				"SMTP_USER":     "user",
				"SMTP_PASSWORD": "pass",
				"SMTP_FROM":     "from@example.com",
			},
			true,
		},
		{
			"missing from",
			map[string]string{
				"SMTP_HOST":     "smtp.example.com",
				"SMTP_PORT":     "587",
				"SMTP_USER":     "user",
				"SMTP_PASSWORD": "pass",
			},
			true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			for _, key := range []string{"SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASSWORD", "SMTP_FROM"} {
				t.Setenv(key, "")
			}
			for k, v := range tt.env {
				t.Setenv(k, v)
			}

			cfg, err := LoadSMTPConfig()
			if (err != nil) != tt.wantErr {
				t.Errorf("LoadSMTPConfig() error = %v, wantErr %v", err, tt.wantErr)
			}
			if !tt.wantErr {
				if cfg.Host != tt.env["SMTP_HOST"] {
					t.Errorf("Host = %q, want %q", cfg.Host, tt.env["SMTP_HOST"])
				}
				if cfg.From != tt.env["SMTP_FROM"] {
					t.Errorf("From = %q, want %q", cfg.From, tt.env["SMTP_FROM"])
				}
			}
		})
	}
}

func TestRenderInviteEmail(t *testing.T) {
	body := RenderInviteEmail("https://app.ebenaum.fr", "TESTCODE123")

	if !strings.Contains(body, "https://app.ebenaum.fr?code=TESTCODE123") {
		t.Errorf("email body should contain the invite link, got: %s", body)
	}
}
