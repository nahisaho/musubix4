# musubix4

**最新リリース v0.1.0 · GitHub Copilot CLI 専用 · Node.js 20以上 · TypeScript · MIT**

[English](README.md) · [変更履歴](CHANGELOG.md) · [ライセンス](LICENSE)

musubix4はGitHub Copilot CLIを、リポジトリローカルな仕様駆動開発（SDD）
Skillsと決定的な証拠検査で拡張します。開発エンジンは引き続きCopilotです。
musubix4は要求、設計判断、テストID、追跡可能性、リリース準備状況を
再レビュー・再検証できるファイルとして保存します。

## musubix4 が必要な理由

コーディング会話が成功しても、要求、設計、実装、テストが現在も一致している
ことの永続的な証明にはなりません。musubix4はCopilotネイティブの計画、編集、
テスト、レビューを次のfail-closedなワークフローで補完します。

- EARS要求と測定可能な受入条件
- component、依存、制約、ADRを含む設計
- 要求から設計、コード、テストへの追跡可能性
- 構造化test reportによるRed/Green/Refactor証拠
- TypeScript Code Graphとarchitecture cycle検査
- 明示したモデル範囲に対する任意のZ3/Lean整合性検査
- input fingerprint、保護policy、承認、quality gate

本リポジトリはmusubix3の知見を基に新規構築した後継です。過去のMUSUBIXとの
成果物互換やmigrationは保証しません。

## インストール

前提:

- Node.js 20以上
- GitHub Copilot CLI
- Git

プロジェクトごとに、次のSkill導入方法から1つだけ選択してください。

npmおよびrepository/pluginコマンドは、v0.1.0が対応するregistryとrepositoryへ公開された後に利用可能になります。

### npmによるプロジェクトローカル導入

```sh
npm install --save-dev --save-exact musubix4@0.1.0
npx --no-install musubix4 init --dry-run
npx --no-install musubix4 init
copilot
```

この方法はversion固定されたSDD Skillsを`.github/skills/`へコピーし、
`.musubix/`の雛形を作成します。全コントリビューターとCIが同じ手順を使える
よう、生成ファイルをコミットしてください。

### GitHub Copilot CLIネイティブプラグイン

```sh
copilot plugin install nahisaho/musubix4
```

プラグイン経由ではCopilot CLIがSkillsを読み込み、`.musubix/`雛形はコピー
しません。同じプロジェクトでnpm経由の`init`と併用しないでください。

## ワークフロー

変更ごとにCopilotへ`sdd-change`の使用を依頼します。このSkillが要求、設計、
実装、追跡可能性、品質、知識、formal/Code Graph、issue報告の各Skillを
調整します。

1. 測定可能な要求を定義して検証する。
2. requirements承認を明示的に取得する。
3. component、interface、制約、依存、ADRを設計する。
4. design承認を明示的に取得する。
5. 実装前に本当に失敗するRedテストを記録する。
6. 最小で完全な実装を行いGreenを記録する。
7. trace、graph、formal、workflow、quality証拠を再生成する。
8. release candidateを独立レビューし、release承認を記録する。

主要コマンド:

```sh
npx --no-install musubix4 requirements validate .musubix/features/<feature>/requirements.md
npx --no-install musubix4 design validate .musubix/features/<feature>/design.md
npx --no-install musubix4 tdd red TEST-FEATURE-001 --requirement REQ-FEATURE-001 --command test
npx --no-install musubix4 tdd green TEST-FEATURE-001 --requirement REQ-FEATURE-001 --command test
npx --no-install musubix4 trace build
npx --no-install musubix4 trace check --strict
npx --no-install musubix4 graph index
npx --no-install musubix4 graph gate
npx --no-install musubix4 gate --changed
npx --no-install musubix4 approval prepare release
```

requirements/design承認は正確なartifact manifestへ結び付きます。release承認は
candidateと証拠のレビュー後にのみ記録します。

## 検証

このリポジトリでは次を実行します。

```sh
npm ci
npm run typecheck
npm run build
npm test
npm run pack:check
```

`pack:check`は実際のnpm archiveを作成して内容を検査します。release verifierは
root `package.json`をversion authorityとし、workspace/lockfile、plugin metadata、
README marker、CHANGELOG先頭の日付付きheading、build済みCLI、archive内の対象
ファイルを照合します。

プロジェクトで利用する主な検査:

```sh
npx --no-install musubix4 constitution validate
npx --no-install musubix4 requirements validate .musubix/features/<feature>/requirements.md
npx --no-install musubix4 design validate .musubix/features/<feature>/design.md
npx --no-install musubix4 trace check --strict
npx --no-install musubix4 graph gate
npx --no-install musubix4 gate --changed --json
npx --no-install musubix4 status --json
```

## 配布

v0.1.0は次の配布方法をサポートします。

- `musubix4` npm packageと`npx musubix4` CLI
- `musubix4 init`で配置するproject-local Skills
- `plugin.json`で定義するGitHub Copilot CLIネイティブプラグイン
- `.github/plugin/`のCopilot plugin marketplace catalog

release preparationはrepository versionを検証し、npm tarball、CycloneDX SBOM、
SHA-256 checksumを生成します。publishは別途明示承認が必要な操作です。

## 証拠リファレンス

`change-record <CHANGE-ID>`はfingerprintが変化していないphaseをfail-fastで
拒否します。`--allow-unchanged`はレビュー済みdefect correctionに限定され、
`--dry-run`は永続化せずに記録内容を確認します。append-onlyな`order`が検証済み
chronology authorityであり、`recordedAt`は順序保証を持たないwall-clock値です。

`tdd red\|green\|refactor`の最初のcycleが永続化されると、TDDはproject-wideな
証拠要件になります。mandatory requirementにcoverageがなければ
`TDD_REQUIREMENT_UNCOVERED`となり、release承認も拒否されます。

`workflow waiver record-all --approver <name> --reason <text> --confirm`は、
現在のdeclaration-scoped diagnosticsに対するall-or-nothing waiverです。
`WORKFLOW_INVOCATION_UNVERIFIED`を隠すことはできません。

#### Attestation evidence-head composition

attestationはTDD chain tip、workflow event digest、change order、formal、
performance、mutation、model correspondence、quality、workspace snapshotの
正規化されたheadを結合し、可変なraw output全体を署名対象にはしません。

## 制限事項

- musubix4はGitHub Copilotを置き換えず、Copilotが開発を実行します。
- 別のagent runtimeを追加せず、MCP/LSP manager、memory service、REPL、
  watcherも追加しません。
- SATを実装の正しさの証明として扱いません。formal checkが証明するのは
  明示的にモデル化した制約だけです。
- trace linkはartifact間の接続を示しますが、振る舞いの正しさは証明しません。
- gate passは設定済み必須証拠がcurrentであることを示し、普遍的な正しさや
  securityを保証しません。
- local process/file制御はOS sandboxではありません。

<!--
@id CODE-RELEASE-V010-DOCS-002
@implements REQ-RELEASE-V010-DOCS-002
@design DES-RELEASE-V010-DOCS-001
-->
