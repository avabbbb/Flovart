package model

import "time"

// User 共享生态注册用户
type User struct {
	ID        string    `gorm:"primaryKey;type:uuid;default:gen_random_uuid()" json:"id"`
	Username  string    `gorm:"size:32;uniqueIndex;not null" json:"username"`
	Email     string    `gorm:"size:255;uniqueIndex;not null" json:"email"`
	Password  string    `gorm:"size:255;not null" json:"-"`          // bcrypt hash
	Bio       string    `gorm:"size:500" json:"bio"`
	AvatarURL string    `gorm:"size:500" json:"avatarUrl"`
	Role      string    `gorm:"size:16;default:'user';index" json:"role"` // user | admin
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

// PromptPack 提示词包 — 节点级创作提示词生态的共享单元
type PromptPack struct {
	ID          string    `gorm:"primaryKey;type:uuid;default:gen_random_uuid()" json:"id"`
	Slug        string    `gorm:"size:80;uniqueIndex;not null" json:"slug"`
	Title       string    `gorm:"size:120;not null;index" json:"title"`
	Description string    `gorm:"size:1000" json:"description"`
	AuthorID    string    `gorm:"type:uuid;index;not null" json:"authorId"`
	Author      *User     `gorm:"foreignKey:AuthorID" json:"author,omitempty"`
	Mode        string    `gorm:"size:24;index" json:"mode"`           // image | video | text
	Tags        []string  `gorm:"type:text[]" json:"tags"`             // pg text[]
	Items       []PromptItem `gorm:"foreignKey:PackID" json:"items"`
	LikeCount   int       `gorm:"default:0;index" json:"likeCount"`
	DownloadCount int     `gorm:"default:0" json:"downloadCount"`
	CreatedAt   time.Time `json:"createdAt"`
	UpdatedAt   time.Time `json:"updatedAt"`
}

// PromptItem 提示词包内单条提示词
type PromptItem struct {
	ID      string `gorm:"primaryKey;type:uuid;default:gen_random_uuid()" json:"id"`
	PackID  string `gorm:"type:uuid;index;not null" json:"packId"`
	Name    string `gorm:"size:120;not null" json:"name"`
	Prompt  string `gorm:"type:text;not null" json:"prompt"`
	Sort    int    `gorm:"default:0" json:"sort"`
}

// PromptLike 提示词包收藏关系
type PromptLike struct {
	UserID string    `gorm:"type:uuid;primaryKey" json:"userId"`
	PackID string    `gorm:"type:uuid;primaryKey" json:"packId"`
	User   *User     `gorm:"foreignKey:UserID" json:"user,omitempty"`
	Pack   *PromptPack `gorm:"foreignKey:PackID" json:"pack,omitempty"`
	CreatedAt time.Time `json:"createdAt"`
}