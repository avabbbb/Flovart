package handler

import (
	"log"
	"net/http"

	"github.com/gin-gonic/gin"

	"flovart/hub/apperr"
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

// FailErr 把 service 层错误映射为响应：业务错误按其状态码与文案返回，
// 其余（数据库、存储等）记录日志后统一返回 500，不向客户端透出内部细节。
func FailErr(c *gin.Context, err error) {
	if e := apperr.As(err); e != nil {
		Fail(c, e.Status, e.Msg)
		return
	}
	log.Printf("internal error: %s %s: %v", c.Request.Method, c.FullPath(), err)
	Fail(c, http.StatusInternalServerError, "服务器内部错误")
}
