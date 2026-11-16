# 邮件观影短链接

`https://04320.com/v/env_1/123` 返回 302 到本站 `/watch?source=env_1&id=123&index=0`。可选 `index` 保留集数。两个地址均不包含第三方片源 URL；其他查询参数不转发。来源只接受 env_ 加数字，影片编号仅接受字母、数字、下划线和连字符。非法参数返回 404，无任意站外跳转能力。

播放仍使用网站现有配置与登录检查。片源编号属于链接契约，不应重新分配给不同片源；删除片源会使历史链接失效。本实现不引入数据库或掩盖最终播放来源，也不能保证邮件客户端取消风险提示。

上线顺序：先发布网站并验证短链接，再更新邮件系统 `app/newsletter_movie_links.php` 与 `app/newsletter_movie_template.php`。新生成的模板、预览和周期邮件统一转换04320的watch链接。既有冻结计划、已保存的HTML模板和已发邮件不会自动改写；现有模板需重新生成。手工填写的非04320观影地址保持原行为。

本地验证：PHP newsletter_movie_links_test.php、Vitest newsletter-links.test.ts；无真实发信。
