package service

import "strings"

func NormalizeAccountStatus(status string) (string, bool) {
	status = strings.ToLower(strings.TrimSpace(status))
	switch status {
	case "active", "suspended", "deleted":
		return status, true
	default:
		return "", false
	}
}

func NormalizeMembershipStatus(status string) (string, bool) {
	status = strings.ToLower(strings.TrimSpace(status))
	switch status {
	case "active", "suspended":
		return status, true
	default:
		return "", false
	}
}
