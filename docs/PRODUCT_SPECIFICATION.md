# REALDONE

> **Trạng thái: NORMATIVE — nguồn sự thật của sản phẩm.** Tài liệu này quy định phạm vi full product, hành vi chức năng, tiêu chuẩn chất lượng, roadmap và điều kiện phát hành cho toàn bộ team và coding agent. Khi tài liệu khác mâu thuẫn, tài liệu này được ưu tiên. Một capability chỉ được đánh dấu hoàn thành khi có implementation thật, evidence và release gate chạy được; skeleton, type hoặc README không đủ. Mọi thay đổi phạm vi phải cập nhật tài liệu này trong cùng pull request.
## Full Product Functional and Quality Specification

**Tên sản phẩm:** RealDone
**Loại sản phẩm:** Open-source behavioral verification platform
**Hình thức:** core local-first, full CLI, local MCP server, browser automation, web report, CI integration, coding-agent verification
**Đối tượng:** Vibe coder, indie hacker, developer dùng coding agent, agency, đội QA và nền tảng AI app builder

---

# 1. Tuyên bố sản phẩm

RealDone là nền tảng kiểm chứng xem các chức năng hiển thị trong một ứng dụng web có thật sự tạo ra kết quả đúng, quan sát được và bền vững hay không.

RealDone không hỏi:

> Code có đẹp không?

RealDone hỏi:

> Chức năng người dùng nhìn thấy có thật sự hoạt động không?

Một ứng dụng có thể trông hoàn chỉnh:

* form nhập được;
* nút Save có loading;
* toast thành công xuất hiện;
* item mới xuất hiện trong bảng;
* modal tự đóng;
* trang chuyển đến màn hình thành công;
* coding agent báo task đã hoàn thành.

Nhưng bên dưới có thể không có kết quả thật:

* dữ liệu chỉ nằm trong React state;
* refresh là mất;
* request không xảy ra;
* API trả thành công nhưng không ghi nguồn dữ liệu;
* Delete chỉ xóa phần tử khỏi DOM;
* upload chỉ tạo URL `blob:`;
* dashboard dùng dữ liệu mẫu;
* payment success route có thể mở trực tiếp;
* quyền chỉ được ẩn ở frontend;
* agent nói “completed” nhưng behavior không thay đổi.

RealDone không tin vào giao diện, response `success: true` hoặc lời xác nhận của coding agent.

RealDone yêu cầu bằng chứng.

---

# 2. Công thức cốt lõi

```text
Visible action
→ Real browser execution
→ Observable evidence
→ Persistence verification
→ Source-of-truth confirmation
→ Evidence-backed verdict
→ Reproduction
```

Công thức đầy đủ:

```text
Action discovery
+ Real execution
+ Observable outcome
+ Persistence
+ Behavior contracts
+ Regression detection
+ Agent verification
+ Reproduction
= RealDone
```

---

# 3. RealDone là full product, không phải MVP

RealDone không được phát triển như một demo scanner chỉ bắt vài lỗi trên fixture nội bộ.

Mục tiêu cuối cùng là một nền tảng hoàn chỉnh có thể:

* tự khám phá hành động;
* tự thao tác trên ứng dụng thật;
* record flow khi không thể tự khám phá;
* xác minh persistence;
* đọc lại source of truth;
* phát hiện regression;
* kiểm tra coding agent;
* chạy trong CI;
* mở rộng bằng adapter và plugin;
* tạo finding có bằng chứng và replay.

Việc chia thành phase chỉ là thứ tự triển khai.

Nó không có nghĩa:

* bỏ các phần full;
* thu hẹp dự án thành MVP;
* chỉ tối ưu cho fixture;
* né các case khó;
* tuyên bố hoàn thành khi module mới chỉ có skeleton.

---

# 4. Các chế độ sử dụng

## 4.1. Quick scan

```bash
realdone scan
```

Khi không truyền URL, RealDone tự nhận project trong thư mục hiện tại, tìm lệnh chạy và port, khởi động ứng dụng, scan rồi dừng runtime. URL vẫn là tùy chọn cho ứng dụng đã chạy sẵn hoặc project không hỗ trợ managed discovery.

RealDone tự:

1. mở ứng dụng;
2. khám phá route;
3. tìm action;
4. phân loại action;
5. tự nhập dữ liệu thử;
6. tự thao tác action an toàn;
7. quan sát network, DOM, console và storage;
8. reload;
9. kiểm tra persistence;
10. tạo report.

Quick scan mặc định:

```text
Browser: Chromium
Workers: 1
AI: Off
Video: Off
Database adapter: Off
Destructive actions: Off
External effects: Off
```

Mục tiêu là tạo giá trị đầu tiên nhanh và nhẹ.

Full safe audit dùng ngân sách lớn hơn và deep persistence nhưng vẫn không tự bật destructive/external effects:

```bash
realdone scan --full
```

Mọi mode phải giữ timeout hữu hạn. Khi hết page/action/duration budget, report phải ghi `truncated` thay vì tuyên bố đã kiểm tra toàn bộ.

---

## 4.2. Deep scan

```bash
realdone scan http://localhost:3000 --deep
```

Deep scan có thể thêm:

* hard reload;
* tab mới;
* clean browser context;
* logout/login;
* app restart;
* API read-back;
* database read-back;
* nhiều role;
* trace và video;
* provider confirmation.

---

## 4.3. Record flow

```bash
realdone record http://localhost:3000
```

Người dùng thao tác một lần.

RealDone ghi:

* semantic element fingerprint;
* click;
* fill;
* Enter;
* select;
* checkbox;
* navigation;
* popup;
* tab;
* request;
* response;
* resource được tạo;
* persistence;
* cleanup requirement.

Recorder không được chỉ lưu tọa độ chuột hoặc CSS selector mong manh.

---

## 4.4. Verify contract

```bash
realdone verify .realdone/flows/create-customer.json
```

RealDone tự chạy lại flow đã ghi bằng semantic behavior contract.

Verification phải deterministic.

Nếu selector cũ không còn, RealDone phải thử tìm lại phần tử theo:

1. role;
2. accessible name;
3. label;
4. test ID;
5. nearby text;
6. semantic relationship;
7. CSS fallback.

---

## 4.5. Baseline và regression

```bash
realdone baseline .realdone/flows
realdone ci --baseline .realdone/baseline.json
```

Quy trình:

```text
Behavior baseline
→ Code thay đổi
→ Chạy lại flow liên quan
→ Behavioral diff
→ Expected change
→ Unexpected regression
```

---

## 4.6. Coding-agent verification

Luồng tích hợp chính cho vibe coding là agent gọi RealDone trực tiếp qua MCP:

```bash
realdone mcp
```

Quy trình:

```text
Agent gọi baseline
→ Agent sửa code
→ Agent gọi verify_change
→ RealDone chọn flow liên quan
→ Verify behavior
→ Phát hiện regression
→ Agent sửa và gọi lại RealDone
```

CLI vẫn phải cung cấp toàn bộ chức năng không cần AI. Các adapter `codex`, `claude` và `generic` có thể giữ làm orchestration wrapper tùy chọn cho quy trình RealDone chủ động chạy agent. MCP và CLI phải dùng chung core; không được có detector hoặc verdict riêng cho từng cổng. Lời “completed” của coding agent không phải bằng chứng.

---

# 5. Kiến trúc tổng thể

```text
Developer / CI ──→ Full CLI ──┐
                              ├──→ RealDone Core
Coding agents ───→ MCP ───────┘

RealDone Core
│
├── Project Discovery
├── Runtime Manager
├── Browser Execution Engine
├── Route Discovery
├── Action Discovery Engine
├── Semantic Element Fingerprint
├── Test Data Generator
├── Safe Action Executor
├── Evidence Collector
├── State Snapshot Engine
├── Persistence Verification Engine
├── Intent Engine
├── Detector Engine
├── Verdict Resolver
├── Recorder
├── Behavior Contract Engine
├── Replay Engine
├── Baseline Engine
├── Behavioral Diff Engine
├── Database Adapters
├── Provider Adapters
├── Role Verification
├── Optional Coding-Agent CLI Adapters
├── Benchmark Engine
├── Report Engine
└── Plugin SDK
```

CLI phải truy cập được toàn bộ capability của core. MCP cung cấp các tool an toàn cho agent và không thay thế hoặc thu hẹp CLI. Core không được phụ thuộc bắt buộc vào:

* AI provider;
* cloud account;
* database credential;
* framework cụ thể;
* coding agent;
* hosted dashboard.

---

# 6. Project Discovery và Runtime Manager

RealDone phải có khả năng phát hiện:

* framework;
* package manager;
* dev command;
* build command;
* port;
* health-check route;
* route structure;
* database technology;
* auth provider;
* test framework;
* environment.

Managed discovery mặc định phải hỗ trợ project Node kể cả khi chưa có lockfile hoặc trường `packageManager`, static HTML, và convention phổ biến của Python, PHP, Ruby, .NET, Java, Deno, Go và Rust. Detection phải dựa trên file/script rõ ràng; không được chạy source fragment do heuristic tự đoán. Với runtime tùy biến, URL của app đã chạy là universal boundary: mọi web app truy cập được qua HTTP phải dùng được toàn bộ browser verifier mà không phụ thuộc ngôn ngữ hoặc framework.

Ví dụ:

```bash
realdone init
```

Kết quả:

```text
Framework: Next.js
Package manager: pnpm
Dev command: pnpm dev
Local URL: http://localhost:3000
Auth: Supabase Auth
Database: PostgreSQL
```

Runtime Manager chịu trách nhiệm:

* khởi động app;
* chờ health check;
* phát hiện port;
* thu server log;
* restart khi crash;
* dừng process khi scan kết thúc;
* hỗ trợ production build;
* hỗ trợ Docker khi được cấu hình.

---

# 7. Environment Health Gate

RealDone không được đánh lỗi ứng dụng khi môi trường kiểm thử đang sai.

Trước khi scan chính thức, RealDone phải kiểm tra:

* HTML tải thành công;
* JavaScript chính tải được;
* stylesheet quan trọng tải được;
* asset cấu hình tải được;
* health endpoint hợp lệ;
* không có lỗi bootstrap nghiêm trọng;
* app render đủ để thao tác.

Ví dụ TodoMVC:

```text
/learn.json trả 404
```

Nếu nguyên nhân là static server serve sai root, finding không được tính là lỗi ứng dụng.

Trạng thái phù hợp:

```text
ENVIRONMENT_INVALID
BLOCKED
```

Không được trộn lỗi môi trường vào:

```text
BROKEN
RD001
Application defect
```

Một scan chỉ được chấp nhận khi environment health gate pass hoặc lỗi môi trường được người dùng xác nhận là lỗi thật của app.

---

# 8. Action Discovery Engine

RealDone phải phát hiện hành động người dùng, không chỉ thẻ HTML.

## 8.1. Action cơ bản

* button;
* link;
* form;
* submit;
* menu;
* tab;
* dialog;
* checkbox;
* radio;
* select;
* combobox;
* table action;
* pagination.

## 8.2. Keyboard actions

* input + Enter;
* implicit form submit;
* search bằng Enter;
* chat input;
* command input;
* quick-add;
* keyboard shortcut;
* Escape;
* arrow navigation.

Case TodoMVC:

```text
Focus “What needs to be done?”
→ fill canary
→ press Enter
→ todo created
```

Đây phải được khám phá như action thật.

Không được hard-code:

```text
.new-todo
```

Action phải tổng quát:

```ts
interface KeyboardSubmitAction {
  type: "enter-submit-input";
  input: ElementFingerprint;
  inferredIntent:
    | "create"
    | "search"
    | "send"
    | "navigate"
    | "unknown";
}
```

## 8.3. Dynamic actions

* hover-revealed action;
* context menu;
* dynamically mounted modal;
* lazy-loaded button;
* virtualized list;
* row action;
* action sau scroll;
* popup;
* multi-tab;
* iframe khi policy cho phép.

## 8.4. Complex actions

* upload;
* download;
* drag-and-drop;
* rich text;
* canvas interaction;
* multi-step wizard;
* external redirect;
* OAuth popup.

Khi không thể tự hiểu chính xác, RealDone phải yêu cầu recorded flow thay vì đoán.

---

# 9. Action Classification

Mỗi action phải được phân loại trước khi thực thi.

## Navigation

* mở trang;
* quay lại;
* chuyển tab;
* mở menu.

## Local interaction

* sort;
* filter;
* accordion;
* theme;
* preview;
* dismiss.

Những action này không bắt buộc có backend write.

## Mutation

* create;
* update;
* save;
* rename;
* toggle setting;
* delete.

Đây là nhóm chính cho persistence verification.

## External effect

* email;
* SMS;
* payment;
* export;
* upload;
* invite;
* webhook.

## Destructive

* delete account;
* refund;
* revoke;
* cancel subscription;
* remove database content.

Destructive và external action bị skip mặc định.

---

# 10. Test Data Generator

RealDone phải tạo dữ liệu theo:

* input type;
* label;
* placeholder;
* validation;
* min/max;
* regex;
* select options;
* relationship giữa field.

Canary phải duy nhất:

```text
RD_TEST_CUSTOMER_8421
rd-8421@example.test
RD_TEST_INVOICE_9F31
```

Canary được dùng để:

* tìm resource trong DOM;
* tìm trong response;
* tìm sau reload;
* tìm trong browser context sạch;
* tìm trong database;
* cleanup.

Không được sử dụng dữ liệu dễ trùng như:

```text
Test
John Doe
example@example.com
```

---

# 11. Safe Action Executor

Executor phải:

1. snapshot trước action;
2. điền dữ liệu;
3. thực thi action;
4. đợi state ổn định;
5. capture evidence;
6. kiểm tra hậu quả;
7. chạy persistence strategy;
8. cleanup nếu được phép.

Executor phải ngăn:

* double click ngoài ý muốn;
* retry tạo duplicate;
* stale locator;
* action chạy trên page đã đổi;
* request còn pending nhưng scan đã kết luận;
* dialog chặn browser;
* form autofill sai field.

---

# 12. Evidence Collector

Evidence phải bao gồm:

* URL;
* semantic DOM;
* DOM diff;
* request URL;
* HTTP method;
* request body đã redaction;
* response status;
* response schema;
* redirect;
* WebSocket event;
* console error;
* page error;
* storage diff;
* cookie diff;
* IndexedDB diff;
* screenshot trước/sau;
* trace;
* video tùy chọn;
* download;
* upload;
* provider receipt;
* database diff;
* action timeline.

Evidence phải liên kết được với:

```text
Action
Execution
Finding
Replay
Baseline
```

---

# 13. State Snapshot Engine

```ts
interface StateSnapshot {
  timestamp: string;
  url: string;
  semanticDom: SemanticDom;
  cookies: CookieState[];
  localStorage: Record<string, RedactedValue>;
  sessionStorage: Record<string, RedactedValue>;
  indexedDb?: IndexedDbSnapshot;
  network: NetworkObservation[];
  console: ConsoleObservation[];
  downloads: DownloadObservation[];
  database?: DatabaseObservation;
  provider?: ProviderObservation;
}
```

Snapshot không được lưu secret thô.

---

# 14. Persistence Verification

RealDone phải phân biệt:

```text
MEMORY_ONLY
TAB_PERSISTENT
BROWSER_LOCAL
SESSION_PERSISTENT
BACKEND_PERSISTENT
SOURCE_OF_TRUTH_CONFIRMED
CROSS_USER_CONFIRMED
```

Các chiến lược:

## Immediate

Kết quả xuất hiện ngay sau action.

## Reload

Kết quả còn sau reload.

## Hard reload

Không phụ thuộc cache hiện tại.

## New tab

Kết quả tồn tại trong tab khác.

## Clean browser context

Không mang localStorage/sessionStorage cũ.

## Logout/login

Kết quả còn sau phiên đăng nhập mới.

## App restart

Kết quả còn sau khi server restart.

## API read-back

Resource được đọc lại qua endpoint.

## Database read-back

Source of truth xác nhận.

## Provider confirmation

Dịch vụ ngoài xác nhận.

## Cross-user

Role hoặc user khác thấy đúng hậu quả.

---

# 15. Verdict System

## VERIFIED

Bằng chứng phù hợp với action dự kiến.

## CONTRADICTORY

UI tuyên bố thành công nhưng hậu quả không phù hợp.

## EPHEMERAL

Thay đổi chỉ tồn tại trong memory hoặc DOM.

## BROWSER_LOCAL

Dữ liệu tồn tại trong browser hiện tại nhưng không tồn tại ở clean context.

Đây không mặc định là bug.

## BROKEN

Có lỗi rõ:

* request fail;
* exception;
* duplicate write;
* crash;
* loading vô hạn;
* invalid state.

## NO_EFFECT

Không có thay đổi quan sát được.

## UNCERTAIN

Không đủ bằng chứng.

## SKIPPED

Action không được chạy do policy hoặc thiếu điều kiện.

## EXPECTED_CHANGE

Behavior thay đổi phù hợp với task.

## REGRESSION

Behavior cũ bị phá ngoài phạm vi task.

## ENVIRONMENT_INVALID

Môi trường test không hợp lệ.

---

# 16. Verdict Priority

Một execution có thể tạo nhiều finding.

RealDone phải giữ toàn bộ finding nhưng chọn một primary verdict theo mức nghiêm trọng.

Thứ tự gợi ý:

```text
Safety/security violation
> Duplicate or destructive execution
> Runtime/request failure
> Contradictory success
> Persistence failure
> Browser-local scope
> No effect
> Uncertain
```

Ví dụ:

```text
Một click
→ tạo 2 POST
→ item mất sau reload
```

Kết quả:

```text
Primary verdict: BROKEN
Primary finding: RD003 Duplicate Submission
Secondary finding: RD101 Refresh Disappearance
```

Không được để `EPHEMERAL` che mất duplicate write.

---

# 17. Evidence Hierarchy

## Level 0 — UI claim

```text
Toast: Saved successfully
```

## Level 1 — Action initiated

```text
Click occurred
Form submitted
```

## Level 2 — Request observed

```text
POST /api/customers
```

## Level 3 — Backend accepted

```text
HTTP 201
Resource ID returned
```

## Level 4 — Read-back confirmed

```text
GET /api/customers/:id
→ resource returned
```

## Level 5 — Persistence confirmed

* reload;
* tab mới;
* browser context mới;
* logout/login;
* app restart.

## Level 6 — Source of truth confirmed

Database hoặc provider xác nhận.

## Level 7 — Cross-user confirmed

Role hoặc user khác quan sát hậu quả đúng.

---

# 18. Detector System

## Nhóm A — Visible action

* RD001: Broken Action
* RD002: No Observable Effect
* RD003: Duplicate Submission
* RD004: Stuck Loading
* RD005: Broken Navigation
* RD006: Disabled-After-Click Failure
* RD007: Keyboard Action Missed
* RD008: Action Discovery Failure

## Nhóm B — Persistence

* RD101: Refresh Disappearance
* RD102: Browser-Local Persistence
* RD103: New-Session Disappearance
* RD104: Memory-Only State
* RD105: App-Restart Disappearance

## Nhóm C — CRUD

* RD201: Fake Create
* RD202: Fake Update
* RD203: Fake Delete
* RD204: Partial Update
* RD205: Wrong Resource Update

## Nhóm D — Success integrity

* RD301: Success Before Proof
* RD302: Success Despite Failure
* RD303: Silent Failure
* RD304: False Success Redirect
* RD305: Hard-Coded Success Endpoint

## Nhóm E — Mock và demo

* RD401: Static Demo Data
* RD402: Frontend Fixture Data
* RD403: Static Search
* RD404: Static Dashboard
* RD405: Placeholder Detail Page

## Nhóm F — Authentication

* RD501: Fake Login
* RD502: Logout Does Not Revoke
* RD503: Session Not Persistent
* RD504: Expired Session Accepted
* RD505: Direct Private Route Access

## Nhóm G — Authorization

* RD601: UI-Only Permission
* RD602: Cross-Tenant Read
* RD603: Cross-Tenant Write
* RD604: Revoked Role Still Active
* RD605: Admin Route Exposure

## Nhóm H — File và export

* RD701: Fake Upload
* RD702: Temporary Blob Upload
* RD703: Broken Download
* RD704: Static Export
* RD705: Incomplete Export

## Nhóm I — Payment và external

* RD801: Fake Payment Success
* RD802: Direct Success Route
* RD803: Duplicate Payment
* RD804: Missing Provider Confirmation
* RD805: Webhook Outcome Missing

## Nhóm J — Regression

* RD901: Unexpected Behavior Change
* RD902: Removed Working Action
* RD903: Persistence Regression
* RD904: API Contract Regression
* RD905: Performance Regression

## Nhóm K — Environment

* RD1001: Invalid Static Root
* RD1002: Critical Asset Missing
* RD1003: Bootstrap Failure
* RD1004: Invalid Test Data Environment
* RD1005: Misconfigured Auth State

Environment findings không được tính là application defect nếu nguyên nhân đến từ test harness.

---

# 19. Behavior Contracts

```yaml
id: create-invoice
name: Create and export invoice

role: admin

steps:
  - open: /customers

  - click: Create customer

  - fill:
      name: RD_TEST_CUSTOMER
      email: rd-test@example.test

  - click: Save

  - click: Create invoice

  - fill:
      amount: 100

  - press: Enter

  - click: Export PDF

verify:
  customer:
    persistsAfterRefresh: true
    persistsInCleanContext: true

  invoice:
    sourceOfTruth: required

  download:
    type: application/pdf
    nonEmpty: true

cleanup:
  - delete_test_customer
```

Contracts phải version-control được.

---

# 20. Replay

Mọi finding quan trọng phải replay được:

```bash
realdone replay RD-014
```

Replay phải:

* dùng semantic fingerprint;
* tạo canary mới;
* tái thực hiện action;
* thu evidence mới;
* xác nhận finding còn tồn tại;
* không phụ thuộc DOM ordinal cũ;
* không hard-code project cụ thể.

Replay failure phải được báo rõ:

```text
Finding reproduced
Finding no longer reproduced
Environment changed
Target action not found
Replay uncertain
```

---

# 21. Report

Output:

```text
.realdone/reports/<scan-id>/
├── report.html
├── summary.json
├── findings.json
├── screenshots/
├── traces/
├── videos/
├── network/
├── contracts/
└── reproductions/
```

Mỗi finding phải có timeline:

```text
00:00 Opened /settings
00:01 Filled display name with RD_TEST_8F21
00:03 Clicked Save
00:03 Toast appeared: Saved successfully
00:03 Write requests: none
00:05 Reloaded page
00:06 Value reverted

Verdict:
CONTRADICTORY
```

Report phải phân biệt:

* app defect;
* environment defect;
* skipped action;
* unverified action;
* regression;
* expected change.

---

# 22. Database Adapters

Adapter phải hỗ trợ:

* PostgreSQL;
* SQLite;
* Prisma;
* Supabase;
* Firebase;
* MongoDB;
* custom database.

Database adapter cần:

* read-only mode mặc định;
* schema discovery;
* primary key;
* row diff;
* soft-delete detection;
* parameterized query;
* explicit TLS policy;
* secret redaction;
* cleanup ledger.

---

# 23. Provider Adapters

Provider SDK cho:

* Stripe test mode;
* Resend;
* SendGrid;
* Mailgun;
* S3;
* Supabase Storage;
* OAuth;
* custom provider.

Production provider bị chặn mặc định.

---

# 24. Multi-role Verification

```yaml
roles:
  admin:
    state: .realdone/auth/admin.json

  member:
    state: .realdone/auth/member.json

  guest:
    anonymous: true
```

RealDone phải kiểm tra:

* UI visibility;
* API authorization;
* direct route access;
* cross-user read;
* cross-user write;
* role revocation;
* session invalidation.

---

# 25. Safety

Trước khi tự thao tác một project, CLI tương tác phải hỏi xác nhận đúng một lần rằng target là local/staging dùng dữ liệu có thể bỏ. Câu hỏi phải cảnh báo rằng handler cùng origin có thể che giấu email, payment, webhook hoặc provider effect. Chỉ khi người dùng đồng ý RealDone mới bắt đầu runtime/browser action.

Trong môi trường không tương tác, quyền này phải được cấp tường minh (`--yes` cho CLI hoặc quyền project-session khi khởi động MCP); thiếu quyền thì fail closed trước khi chạy action. Quyền project không thay thế các quyền riêng cho external, destructive hoặc production-like host.

Mặc định full mutation chỉ cho phép trên:

* localhost;
* `127.0.0.1`;
* `.test`;
* `.local`;
* staging domain được allow.

Chặn mặc định:

* production payment;
* SMS;
* email;
* refund;
* delete account;
* destructive cloud API;
* production database mutation.

Test resource dùng prefix:

```text
RD_TEST_<timestamp>_<random>
```

Cleanup ledger phải ghi mọi resource được tạo.

---

# 26. Benchmark System

Benchmark không được dùng quick-scan budget mặc định.

Benchmark phải chạy toàn bộ expectation set.

Nếu bị cắt do budget:

```text
benchmarkTruncated = true
```

Release phải fail.

Các chỉ số:

```text
actionDiscoveryRate
detectorAccuracy
verdictAccuracy
findingPrecision
findingRecall
falsePositiveRate
expectationCoverage
reproductionSuccess
cleanupSuccess
environmentValidity
```

Release fail khi:

* expectation coverage dưới 100%;
* verdict accuracy dưới threshold;
* detector accuracy dưới threshold;
* fixture bị skip ngoài dự kiến;
* benchmark bị truncate;
* correct control báo lỗi;
* replay không tái hiện;
* environment invalid nhưng vẫn tính pass.

---

# 27. Real-world Case Studies

Fixture nội bộ không đủ chứng minh chất lượng.

RealDone phải thử trên project bên ngoài.

Quy trình:

```text
Chạy project thật
→ ghi nhận false negative/positive
→ không đổi project để dễ pass
→ tìm nguyên nhân tổng quát
→ thêm fixture
→ thêm correct control
→ sửa engine
→ chạy benchmark
→ chạy lại project thật
→ công bố kết quả trước/sau
```

TodoMVC là case đầu:

```text
Before:
Enter-submit action bị bỏ sót

After:
Action được phát hiện
Canary được tạo
localStorage thay đổi
Survives reload
Absent in clean context
Verdict: BROWSER_LOCAL
```

Các project tiếp theo phải bao gồm:

* backend CRUD;
* PostgreSQL;
* Supabase;
* authentication;
* upload;
* export;
* multi-role;
* app AI-generated;
* flow nhiều bước.

---

Published case-study evidence must pin the upstream commit and license, preserve the minimal injected fault as a patch, record exact clean/fault run IDs, and SHA-256-bind the raw reports. Large disposable checkouts and raw artifacts may remain local when the compact manifest is reproducible and no external project code is redistributed.

---

# 28. Engineering Quality

Repository phải có:

* commit nhỏ;
* pull request;
* code review;
* CI;
* test riêng cho detector;
* fixture lỗi;
* correct control;
* changelog;
* semantic versioning;
* third-party license tracking;
* dependency audit.

Không được:

* một commit chứa cả phase lớn;
* sửa detector mà không có regression test;
* thay public interface không migration;
* thêm plugin SDK trước khi có implementation thật;
* benchmark chỉ kiểm tra discovery mà bỏ verdict correctness.

---

# 29. Release Gates

Một release chỉ được phát hành khi:

1. Typecheck pass.
2. Unit test pass.
3. Browser integration pass.
4. Benchmark không bị truncate.
5. Expectation coverage đạt 100%.
6. Verdict accuracy đạt threshold.
7. Detector accuracy đạt threshold.
8. Correct controls không bị báo sai.
9. Replay success đạt threshold.
10. Cleanup pass.
11. Environment health gate pass.
12. Cross-platform smoke pass.
13. Report schema backward-compatible.
14. Không có secret trong artifact.
15. Case study bên ngoài không regression nghiêm trọng.

Không được release chỉ vì:

* code build được;
* fixture demo pass;
* README đã cập nhật;
* coding agent nói hoàn thành.

---

# 30. Performance Quality

Quick scan phải giữ nhẹ:

```text
1 browser
1 worker
no AI
no video
no database
safe actions only
```

Full audit mới bật:

* nhiều browser;
* nhiều role;
* nhiều worker;
* database;
* provider;
* video;
* app restart.

RealDone phải hỗ trợ:

* scan budget;
* incremental scan;
* affected-flow selection;
* snapshot deduplication;
* trace only on failure;
* parallel worker giới hạn;
* timeout rõ ràng.

---

# 31. UX Quality

Giá trị đầu tiên phải đạt bằng:

```bash
npx realdone scan
```

Lệnh một dòng có thể hỏi một câu xác nhận safety cho project trước lần thao tác; không được hỏi lặp lại cho từng nút. CI/MCP phải dùng xác nhận tường minh, không được tự mặc định câu trả lời là “yes”.

Không bắt buộc:

* tài khoản;
* dashboard;
* API key;
* cloud;
* database credential;
* tự viết Playwright test.

Report đầu tiên phải dễ hiểu với người không biết code.

---

# 32. Định nghĩa hoàn thành full project

RealDone chỉ được xem là full product hoàn chỉnh khi:

* tự khám phá được phần lớn action web phổ biến;
* phát hiện được keyboard và implicit action;
* record được flow phức tạp;
* verify deterministic;
* phân biệt đúng persistence scope;
* xác nhận được source of truth;
* chạy được baseline và regression;
* tích hợp coding agent;
* hỗ trợ multi-role;
* có adapter ecosystem;
* finding có evidence;
* finding có replay;
* benchmark có verdict accuracy;
* environment defect không bị tính thành app defect;
* hoạt động trên project bên ngoài;
* an toàn local/staging;
* chạy được không cần AI;
* sử dụng được qua một command;
* CI ổn định;
* plugin API có tài liệu;
* Windows, macOS và Linux được hỗ trợ.

RealDone là:

> **Một behavioral verification platform hoàn chỉnh dùng browser thật và bằng chứng thực tế để xác định ứng dụng có hoạt động thật hay chỉ đang tạo cảm giác đã hoàn thành.**
