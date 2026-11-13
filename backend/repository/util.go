package repository

import (
	"strings"

	"github.com/google/uuid"
)

// IsUUID 判断字符串是否为合法 UUID；用于在查询 uuid 列前短路，避免把非法输入送进 Postgres 报 22P02。
func IsUUID(s string) bool {
	_, err := uuid.Parse(s)
	return err == nil && len(s) == 36
}

// escapeLike 转义 LIKE/ILIKE 通配符，让关键词按字面匹配
func escapeLike(s string) string {
	return strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(s)
}
