package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

// OK 业务响应统一格式 { code, data, msg }
func OK(c *gin.Context, data any) {
	c.JSON(http.StatusOK, gin.H{
		"code": 0,
		"data": data,
		"msg":  "ok",
	})
}

// Fail 失败响应；httpCode 同时作为业务 code 字段
func Fail(c *gin.Context, httpCode int, msg string) {
	c.JSON(httpCode, gin.H{
		"code": httpCode,
		"data": nil,
		"msg":  msg,
	})
}