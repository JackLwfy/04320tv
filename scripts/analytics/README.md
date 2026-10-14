# 04320 数据统计

网站与后台仍在 EdgeOne；Node 云函数通过校验证书的 TLS 连接独立 MariaDB 库。数据库服务器没有新增 HTTP 服务。

## 数据和页面

后台「数据统计」提供概览、访问分析、搜索需求、内容热度、播放质量、订阅转化、采集运行。支持北京时间日期、适用的片源/播放类型/设备/浏览器筛选、分页及当前页 CSV；CSV 时长使用毫秒，公式前缀已转义。

- 浏览器匿名标识保存在签名 HttpOnly Cookie 中，数据库只存 HMAC 后的标识。测试访客使用独立哈希域，所有验收数据标记 `is_test=1`。
- 访问次数以连续 30 分钟无活动划分。UV 是区间内浏览器去重数，不代表真实人数。
- 搜索按逻辑 searchId 去重；正常无结果、部分失败、全部失败分开。点击/起播转化以范围内的搜索为基准，并核对匿名设备。显式重复搜索同一个词会产生新逻辑搜索；命中缓存时不伪造新的片源网络耗时样本。
- 每个播放尝试保存最新累计快照。递增序号、所有累计值不回退、归属匿名设备一致才允许更新（保留最初会话，允许暂停后新访问继续累计）。观看时长排除暂停、跳转和缓冲，后台播放是其中的子集。
- 首帧优先使用 video frame callback，旧浏览器采用进度前进；45 秒未起播记超时。用户提前离开单独统计。有效观看为至少30秒，短视频需完整播放。
- 观看数据按尝试开始日归属。不同片源同名内容不自动合并。来源 key 在浏览器发送前哈希；不保存带令牌媒体地址和邮箱。
- 推荐记录可见曝光、点击以及关联搜索后的起播。订阅的 accepted 仅表示接口受理；确认、退订、发信、送达需外部回传，当前不伪装为零。
- 浏览器行为是可漏报、可伪造的观测，不等于服务端探测、邮件送达或真实人数。

## 资源和留存

每个云函数实例最多2个数据库连接，等待队列最多4项；数据库用户总连接上限12。批次最多20个事件、请求体32KiB；签名会话、同源限制、字段边界和数据库限流同时生效。明细查询限制4秒。数据库故障时采集返回503，前台有限重试且不阻止播放，后台显示不可用而不是假零。

结构化事实、播放、搜索源结果保留90个完整北京时间日期；短期回执2天；日汇总和匿名访客最多400天。未额外保存原始JSON心跳或完整错误日志，因此采用统一90天结构化明细留存。超过90天只提供无细分的日汇总概览，不能跨日相加生成区间UV，也不平均每日P95。

`maintenance.py` 仅允许固定服务器和独立库：5分钟幂等汇总、每日分批清理、每日备份。任务互斥，状态写入 `analytics_jobs`。备份仅短暂锁本统计库，生成一致快照并真实恢复到随机临时库，核对10张表行数，删除临时库后保留最近7份成功备份。服务器备份/清理在服务器本地时间03:17/03:37；服务器采用欧洲时区，会随夏令时变化。

`pull-backup.ps1` 经 Tailscale 拉取已恢复验证的备份到仓库外私有目录，逐文件核对 SHA256，保留7份。Windows 任务每日北京时间11:00运行，错过后启动时补跑；需要这台电脑开机、用户登录及 Tailscale 可用。状态在私有目录 `offsite-backup-status.txt`。长期无人值守应改为常在线异地存储。

## 配置与操作

EdgeOne 仅服务器环境变量：`ANALYTICS_DB_HOST`、`ANALYTICS_DB_PORT`、`ANALYTICS_DB_NAME`、`ANALYTICS_DB_USER`、`ANALYTICS_DB_PASSWORD`、`ANALYTICS_DB_TLS_NAME`、`ANALYTICS_DB_CA`、`ANALYTICS_INGEST_SECRET`、`ANALYTICS_ENABLED`。CA 在 EdgeOne 中以字面 `\n` 保存，应用解码；不要在平台环境变量中写真实多行。TLS证书名称与连接IP独立校验。所有统计连接会话设置UTC，不改变服务器全局时区。

初始化脚本必须先核验服务器身份；`create` 通过 aaPanel 建独立库和最小权限用户，`tls`/`activate`涉及数据库服务重启，仅首次部署需要。`schema` 只为指定库执行幂等建表。禁止重跑首次初始化去覆盖已有数据库或证书。

在项目根目录运行以下单行命令。配置、API密钥及备份均在仓库外/忽略文件中，不随代码和ZIP发布。

- 部署状态：`node scripts/analytics/edgeone-ops.cjs status`
- 线上 TLS 健康检查：`node scripts/analytics/edgeone-ops.cjs health`
- 隔离线上验收：`node scripts/analytics/smoke.cjs https://04320.com`
- 有限4并发、400事件验收：`node scripts/analytics/smoke.cjs https://04320.com --load`
- 全仓检查：`npm test; npm run lint; npm run typecheck; npm run build`
- 实库集成测试（本地已配置隔离环境）：`$env:ANALYTICS_INTEGRATION='true'; node --env-file=.env.local node_modules/vitest/vitest.mjs run src/lib/analytics-integration.test.ts; Remove-Item Env:ANALYTICS_INTEGRATION`

`smoke.cjs` 使用管理员权限请求隔离测试令牌，检查授权、来源、校验、去重、7视图和CSV，结束时仅删除本次访客测试记录。普通用户不能启用测试模式。`ANALYTICS_TEST_MODE` 只用于本地验收，禁止设置到线上。

## 停用与回滚

紧急停采可在独立统计库执行 `UPDATE analytics_meta SET enabled=0 WHERE id=1`，立即阻止新事实入库；恢复改回1。前台搜索播放不依赖统计成功。

永久停采用 `node scripts/analytics/edgeone-ops.cjs disable` 然后 `node scripts/analytics/edgeone-ops.cjs deploy`，等待成功；恢复用 `enable` 再部署。环境变量变更必须重新部署才会进入云函数。

代码回滚使用新提交恢复需要的版本，再推送部署，不强推、不删除统计库。原有 EdgeOne 环境变量、aaPanel数据库、数据库服务配置均已在私有目录备份。回滚 TLS 配置会影响这个统计用户的连接，只有确认其它业务状态和服务重启窗口后才操作；常规停采不需要恢复全局数据库配置。

统计从启用时开始，没有可追溯的历史访问数据。已有依赖的安全审计不是本统计功能验收的替代品；本次未做无关框架大版本升级。
