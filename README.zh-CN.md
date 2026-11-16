# 在 CI/CD 里自动完成短信 OTP 测试

> 用 Playwright、webhook 和可接收短信的号码，给你自己应用的注册、登录流程做端到端测试。不靠时灵时不灵的等待，也不在后端留测试后门。

[English](README.md) | [Русский](README.ru.md) | 简体中文

## 这个仓库讲了什么

给注册或登录流程写端到端测试时，流水线经常卡在短信验证码这一步：云端容器里没有 SIM 卡，测试要么一直等到超时，要么只能有人手动输入验证码。

这个仓库把常见做法按风险排了序，并附了一段 Playwright 示例：

**不推荐的做法**

- **只用 Firebase、Twilio 的测试号码。** 本地调 UI 很方便，但 Firebase 测试号码最多只能加 10 个，CI 并行一多就不够用，也测不到真实的国际短信送达。
- **旧安卓手机加短信转发应用。** 手机会掉线、会被系统休眠，多个任务同时跑时一部手机根本接不过来。
- **在后端硬编码 `BYPASS_OTP` 之类的开关。** 测试环境的开关一旦误带到生产环境，任何人输入固定验证码就能登录；而且短信模块被整个跳过，服务商接口出问题时测试照样全绿。

**可行的做法**

1. **本地隔离：** 用 WireMock、Mockoon 这类 mock 服务器拦截发往短信网关的请求。
2. **深度集成：** 测试直接从测试数据库或 Redis 里读出验证码。
3. **真实短信：** 通过 API 租一个能收短信的号码，把号码填进 UI，再通过 HTTP 拿到验证码。只有这一层能在发版前把整条链路真正跑一遍。

**示例代码做了什么**（TypeScript，`@playwright/test` + `axios`，文件在 [examples/otp-webhook.spec.ts](examples/otp-webhook.spec.ts)）：

1. 在测试进程里起一个临时 HTTP 服务器，接收 HeroSMS 的 webhook 推送；
2. 调用 `getNumberV2` 租一个号码；
3. 在你的登录页提交这个号码，用 `Promise.race` 等待验证码或超时；
4. 输入验证码，断言跳转到登录后的页面；
5. 成功时用 `setStatus` 的状态 `6` 完成激活；任何一步失败，`finally` 里会尝试用状态 `8` 取消激活，并释放端口。

> 注意：激活开始后约 2 分钟内取消可能被拒绝（`EARLY_CANCEL_DENIED`），示例会忽略这个错误；没收到短信的激活到期后费用会自动退回余额。示例的 15 秒超时偏短，国际短信建议放宽到几分钟，同时用 `test.setTimeout()` 调大 Playwright 本身的测试超时（默认 30 秒）。

## 快速开始

需要准备：Node.js、HeroSMS 账户和 API 密钥、一个能从公网访问的 HTTPS 地址（本地调试可以用 ngrok 这类隧道工具）。

```bash
git clone https://github.com/HeroSMS-com/otp-automation-ci-cd.git
cd otp-automation-ci-cd
npm install
npx playwright install chromium
```

1. 示例代码在 [examples/otp-webhook.spec.ts](examples/otp-webhook.spec.ts)，`npm test` 运行的就是 `examples/` 目录下的测试。
2. 在 HeroSMS 的账户设置里填写 webhook 地址。webhook 按账户配置，最多 3 个 HTTPS 地址，不能在每次请求里单独指定。正式的 CI 环境建议只放行网关的来源 IP：`84.32.223.53` 和 `185.138.88.87`。
3. 把示例里的 `https://your-app.com/login` 和各个选择器换成你自己应用的。服务代码 `ot`（Any other）适合测试你自己的应用；示例里的国家 ID 只是演示，换成你要测试的国家，ID 用 `?action=getCountries` 查询。
4. 设置环境变量并运行：

```bash
export HEROSMS_API_KEY=...   # 在 CI 里放进 secrets，不要提交到仓库
export WEBHOOK_PORT=3000     # 可选，默认 3000
npm run typecheck
npm test
```

## 接口要点

- 示例用的是 HeroSMS 兼容 handler_api 协议的接口：`https://hero-sms.com/stubs/handler_api.php`，GET 请求，`api_key` 和 `action` 放在查询字符串里。
- `getNumberV2` 成功时返回 JSON 激活对象（`activationId`、`phoneNumber`、`activationCost` 等）；失败时返回的不是激活对象，比如纯文本 `NO_NUMBERS`，所以示例会先判断返回类型。
- `setStatus`：`6` 表示完成，`8` 表示取消。也可以用等价的 `finishActivation` 和 `cancelActivation`。
- webhook 推送的字段有 `id`、`activationId`、`service`、`text`、`code`（`text` 和 `code` 都可能为 null）、`country`、`phoneFrom`、`receivedAt`。
- 正常的推送都要在 3 秒内返回 `200`，包括重复推送和不属于当前测试的推送；否则网关会每隔 20 到 30 秒重试，至少重试 7 次。
- webhook 对整个账户生效，并行的 CI 任务会收到所有短信事件，所以每个测试只处理和自己 `activationId` 一致的推送。

完整接口说明见 [HeroSMS API 文档](https://hero-sms.com/cn/api?utm_source=gh&utm_medium=otpauto_cn&utm_campaign=16112026)。

## 安全和使用边界

- API 密钥只放在 CI 的加密变量里（GitHub Secrets、GitLab CI Variables 等），通过环境变量传给测试。
- 只测试你自己的应用，或者你有权测试的应用；用测试账号，在 staging 环境跑。
- 一个测试只租一个号码，用完在 `finally` 里尝试关闭。号码只在激活期内（大约 20 分钟）归你使用，不要把它绑到以后还要找回的账号上。
- 收真实短信的测试每次运行都要花钱，适合放在定时任务或发版前跑，不必每个 PR 都跑。

## 许可证

[MIT](LICENSE)
