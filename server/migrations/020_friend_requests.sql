-- M4.10.1 记录好友申请发起人。既有 accepted 行可为空。
ALTER TABLE friendships ADD COLUMN requested_by INTEGER REFERENCES users(id);
