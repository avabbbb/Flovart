// Package apperr 定义可直接暴露给客户端的业务错误。
// 非 *apperr.Error 的错误一律视为内部错误：记录日志，对外只返回通用文案，避免泄露 SQL/存储细节。
package apperr

import (
	"errors"
	"net/http"
)

// Error 携带 HTTP 状态码与面向用户的提示
type Error struct {
	Status int
	Msg    string
}

func (e *Error) Error() string { return e.Msg }

func New(status int, msg string) *Error { return &Error{Status: status, Msg: msg} }

func BadRequest(msg string) *Error   { return New(http.StatusBadRequest, msg) }
func Unauthorized(msg string) *Error { return New(http.StatusUnauthorized, msg) }
func Forbidden(msg string) *Error    { return New(http.StatusForbidden, msg) }
func NotFound(msg string) *Error     { return New(http.StatusNotFound, msg) }
func Conflict(msg string) *Error     { return New(http.StatusConflict, msg) }

// As 取出 *Error；不是业务错误时返回 nil
func As(err error) *Error {
	var e *Error
	if errors.As(err, &e) {
		return e
	}
	return nil
}
