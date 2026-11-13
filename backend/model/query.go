package model

// Query 列表筛选统一入参，沿用项目列表接口契约
type Query struct {
	Keyword  string
	Tags     []string
	AuthorID string
	Mode     string
	Sort     string // latest | popular | downloads
	Page     int
	Size     int
}

// 分页上限：防止超大 size 或极深 offset 拖垮数据库
const (
	MaxPageSize = 50
	MaxPage     = 1000
)

// Normalize 填充默认值并约束边界
func (q *Query) Normalize() {
	if q.Page <= 0 {
		q.Page = 1
	}
	if q.Size <= 0 {
		q.Size = 20
	}
	if q.Size > MaxPageSize {
		q.Size = MaxPageSize
	}
	if q.Page > MaxPage {
		q.Page = MaxPage
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
