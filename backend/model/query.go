package model

// Query 列表筛选统一入参，沿用项目列表接口契约
type Query struct {
	Keyword string
	Tags    []string
	AuthorID string
	Mode    string
	Sort    string // latest | popular | downloads
	Page    int
	Size    int
}

// Normalize 填充默认值并约束边界
func (q *Query) Normalize() {
	if q.Page <= 0 {
		q.Page = 1
	}
	if q.Size <= 0 || q.Size > 50 {
		q.Size = 20
	}
	if q.Sort == "" {
		q.Sort = "latest"
	}
}

// PageResult 分页统一响应
type PageResult[T any] struct {
	List  []T   `json:"list"`
	Total int64 `json:"total"`
	Page  int   `json:"page"`
	Size  int   `json:"size"`
}