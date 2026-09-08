# DEVONthink 3 MCP 사용 안내

DEVONthink 3의 원본 자료를 AI가 검색하고, 출처를 확인하며, 정리 작업을 미리 검토할 수 있는 로컬 MCP 서버입니다. **DEVONthink 3.9.18에서 직접 검증**했습니다.

원본은 DEVONthink에 보관하고 Git 저장소에는 요약과 출처 링크를 남기는 용도에 맞췄습니다. 별도 검색 인덱스나 API 키는 필요 없습니다. 서버는 로컬에서 실행되지만, 응답으로 받은 자료를 AI 클라이언트가 모델 제공자에게 전송할 수 있습니다.

## 설치와 연결

macOS, Node.js 22 이상, 실행 중인 DEVONthink 3이 필요합니다.

Codex 연결:

```sh
npx -y @waylake/devonthink3-mcp@0.2.0 setup --client codex
```

Pi 연결:

```sh
npx -y @waylake/devonthink3-mcp@0.2.0 setup --client pi
```

두 클라이언트 모두 연결하려면 `--client both`를 사용합니다. Codex CLI 또는 Pi가 먼저 설치되어 있어야 합니다. 설정 명령이 열려 있는 DB를 이름으로 보여주면 번호를 선택하고 쓰기 도구 사용 여부를 정합니다. 기본값은 선택한 DB만 읽는 모드입니다. Pi 연결 시 `pi install`로 `pi-mcp-adapter@2.32.1`과 이 패키지를 설치하며, 기존의 다른 MCP 서버와 Pi 패키지는 유지합니다. Git 클론이나 MCP JSON 수동 편집은 필요 없습니다.

설정은 `~/.config/devonthink3-mcp/config.json`에 저장되며, 기존 파일은 `config.json.bak`으로 보관합니다. Codex를 다시 연결하거나 Pi에서 `/reload` 후 `/mcp`를 확인합니다. macOS가 물으면 실행하는 터미널 또는 AI 앱의 DEVONthink 자동화 권한을 허용합니다.

### 열린 DB를 자동으로 따라가기

다음 명령은 **현재와 앞으로 DEVONthink에서 여는 모든 DB에 읽기·쓰기를 허용**합니다.

```sh
npx -y @waylake/devonthink3-mcp@0.2.0 setup --client both --database-mode open --enable-writes
```

이후 DB를 열거나 닫을 때마다 연결 범위가 바뀝니다. 서버 재시작은 필요 없습니다. `--exclude-databases UUID,UUID`로 특정 DB를 제외할 수 있습니다. 정책 설정 자체를 바꾸면 클라이언트를 다시 연결해야 합니다.

클라이언트 기본 설치 명령을 직접 쓰고 싶다면, `npx -y @waylake/devonthink3-mcp@0.2.0 setup`으로 접근 범위를 정한 뒤 실행합니다.

```sh
codex mcp add devonthink3 -- npx -y @waylake/devonthink3-mcp@0.2.0

pi install npm:pi-mcp-adapter@2.32.1
pi install npm:@waylake/devonthink3-mcp@0.2.0
```

설정 도우미는 Codex에 Node/npm의 절대 경로를 등록합니다. 위 수동 명령은 클라이언트에서 `npx`를 찾을 수 있어야 합니다. 설치 버전은 고정되어 있으며 업데이트 시 새 버전의 setup을 실행합니다. Pi는 패키지에 포함된 MCP 설정을 읽고 처음 사용할 때 서버에 연결합니다. 첫 실행에는 npm 패키지를 내려받을 수 있습니다. [Pi 공식 패키지 안내](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/packages.md), [pi-mcp-adapter](https://github.com/nicobailon/pi-mcp-adapter).

## 기본 동작

| 작업 | 지원 방식 |
| --- | --- |
| 검색·탐색 | DEVONthink 검색 문법, 그룹 목록, 현재 선택 항목 |
| 문서 읽기 | 메타데이터, 선택적 사용자 정의 메타데이터, 길이를 제한한 본문 |
| 근거 연결 | `x-devonthink-item://` 원본 링크, MCP 문서 리소스 |
| 관련 자료 찾기 | 유사 문서, 분류 제안, 중복 항목, 역링크와 참조 링크 |
| 문서 정리 | 선택적으로 생성·수정·이동·복제·단일 파일 가져오기 |

처음에는 **읽기 도구 8개**만 노출됩니다. `DT3_ENABLE_WRITES=1`을 설정하고 다시 연결하면 쓰기 도구 5개가 추가됩니다. 변경 도구는 기본적으로 미리보기만 반환합니다. 결과를 검토하고 사용자가 허용한 작업에 `dry_run: false`를 사용합니다.

수정 전에는 `dt3_get_record`의 최신 `revision`을 확인합니다. 같은 프로세스에서 동일 요청을 재시도할 때는 같은 `request_id`를 사용합니다. 서버 재시작이나 시간 초과 뒤에는 현재 문서 상태부터 다시 확인해야 합니다.

태그 수정은 기존 태그 전체를 교체합니다. 유지할 태그가 있다면 먼저 읽어 새 배열에 포함하세요. Replicant는 같은 UUID와 내용을 여러 그룹에서 공유하는 인스턴스이며, 별도의 파일 사본과 다릅니다.

## 접근 범위와 자료 해석

- 선택 모드에서 `DT3_DATABASE_UUIDS`가 비어 있으면 문서 접근을 허용하지 않습니다. 열린 DB 모드는 명시적으로 선택해야 합니다.
- 문서나 상위 그룹에 `mcp-private` 태그를 붙이면 제외됩니다. 공유 인스턴스(Replicant)의 상위 그룹 중 하나라도 비공개면 해당 문서를 차단합니다.
- 본문이 없다는 응답은 원본이 비었다는 뜻이 아닙니다. 스캔 PDF의 OCR, 미디어 전사, 압축 해제, 스프레드시트 수식 계산은 이 서버가 수행하지 않습니다.
- PDF 본문은 DEVONthink의 텍스트를 사용합니다. 전체 페이지 수는 제공하지만 본문 조각이 어느 PDF 페이지에 대응하는지는 보장하지 않습니다.
- 잠긴 문서와 외부 파일을 인덱싱한 문서는 수정하지 않습니다. 그룹 자체의 위치 이동, 데이터베이스 간 이동, 영구 삭제도 제공하지 않습니다.
- 많은 파일을 가져올 때는 DEVONthink에서 직접 처리합니다. MCP 가져오기는 설정한 디렉터리의 파일 한 개, 최대 100 MiB로 제한됩니다.

자세한 변수와 도구 입력은 [영문 README](../README.md), 실제 검증 범위는 [검증 기록](validation.md), 최신 MCP 조사와 구현 결정은 [설계 문서](design.md), [보안 경계](../SECURITY.md)에 있습니다.

DEVONthink 4를 사용한다면 [공식 내장 MCP](https://www.devontechnologies.com/blog/20260526-devonthink-mcp-server)부터 검토하는 편이 간단합니다. 이 프로젝트는 3을 계속 사용하는 사용자를 위한 독립 구현입니다.

DB 구성, 폴더·태그·스마트 그룹의 역할과 에이전트 정리 절차는 [장기 지식 관리 가이드](knowledge-workflow.ko.md)에 정리했습니다.
