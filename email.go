package main

import (
	"fmt"
	"mime"
	"net/smtp"
	"os"
)

type SMTPConfig struct {
	Host     string
	Port     string
	User     string
	Password string
	From     string
}

func LoadSMTPConfig() (SMTPConfig, error) {
	cfg := SMTPConfig{
		Host:     os.Getenv("SMTP_HOST"),
		Port:     os.Getenv("SMTP_PORT"),
		User:     os.Getenv("SMTP_USER"),
		Password: os.Getenv("SMTP_PASSWORD"),
		From:     os.Getenv("SMTP_FROM"),
	}

	if cfg.Host == "" {
		return cfg, fmt.Errorf("SMTP_HOST is required")
	}
	if cfg.Port == "" {
		cfg.Port = "587"
	}
	if cfg.From == "" {
		return cfg, fmt.Errorf("SMTP_FROM is required")
	}

	return cfg, nil
}

func RenderInviteEmail(appURL string, code string) string {
	link := fmt.Sprintf("%s?code=%s", appURL, code)

	return fmt.Sprintf(`<!DOCTYPE html>
<html>
<body>
<h2>Ebenaum GN 2026</h2>
<p>Tu as reçu une invitation pour créer ton personnage !</p>
<p><a href="%s">Clique ici pour commencer</a></p>
<p>Ou copie ce lien dans ton navigateur :</p>
<p>%s</p>
<p><em>Ce lien est à usage unique.</em></p>
</body>
</html>`, link, link)
}

func SendEmail(cfg SMTPConfig, to string, subject string, body string) error {
	encodedSubject := mime.QEncoding.Encode("utf-8", subject)
	msg := fmt.Sprintf("From: %s\r\nTo: %s\r\nSubject: %s\r\nMIME-Version: 1.0\r\nContent-Type: text/html; charset=\"UTF-8\"\r\n\r\n%s",
		cfg.From, to, encodedSubject, body)

	auth := smtp.PlainAuth("", cfg.User, cfg.Password, cfg.Host)

	return smtp.SendMail(
		fmt.Sprintf("%s:%s", cfg.Host, cfg.Port),
		auth,
		cfg.From,
		[]string{to},
		[]byte(msg),
	)
}

func RenderLoginEmail(appURL string, code string) string {
	link := fmt.Sprintf("%s?code=%s", appURL, code)

	return fmt.Sprintf(`<!DOCTYPE html>
<html>
<body>
<h2>Ebenaum GN 2026</h2>
<p>Voici ton lien de connexion :</p>
<p><a href="%s">Clique ici pour te connecter</a></p>
<p>Ou copie ce lien dans ton navigateur :</p>
<p>%s</p>
<p><em>Ce lien est à usage unique.</em></p>
</body>
</html>`, link, link)
}

func SendInviteEmail(cfg SMTPConfig, to string, appURL string, code string) error {
	body := RenderInviteEmail(appURL, code)
	return SendEmail(cfg, to, "Ebenaum GN 2026 — Ton invitation", body)
}

func SendLoginEmail(cfg SMTPConfig, to string, appURL string, code string) error {
	body := RenderLoginEmail(appURL, code)
	return SendEmail(cfg, to, "Ebenaum GN 2026 — Ton lien de connexion", body)
}
