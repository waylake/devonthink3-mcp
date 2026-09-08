# DEVONthink 3 MCP 사용 안내

DEVONthink 3의 원본 자료를 AI가 검색하고, 출처를 확인하며, 정리 작업을 미리 검토할 수 있는 로컬 MCP 서버입니다. **DEVONthink 3.9.18에서 직접 검증**했습니다.

원본은 DEVONthink에 보관하고 Git 저장소에는 요약과 출처 링크를 남기는 용도에 맞췄습니다. 별도 검색 인덱스나 API 키는 필요 없습니다. 서버는 로컬에서 실행되지만, 응답으로 받은 자료를 AI 클라이언트가 모델 제공자에게 전송할 수 있습니다.

## 설치와 연결

macOS, Node.js 22 이상, 실행 중인 DEVONthink 3이 필요합니다.

```sh
git clone https://github.com/waylake/devonthink3-mcp.git
cd devonthink3-mcp
npm ci --ignore-scripts
npm test
npm run doctor
```

`doctor`가 표시하는 데이터베이스 UUID 중 AI에 연결할 대상을 고릅니다. 아래 `YOUR_DATABASE_UUID`를 바꾼 뒤 저장소 디렉터리에서 실행합니다.

```sh
codex mcp add devonthink3 \
  --env "DT3_DATABASE_UUIDS=YOUR_DATABASE_UUID" \
  -- "$(command -v node)" "$PWD/src/index.js"
```

클라이언트를 다시 연결한 뒤 “DEVONthink에서 이 프로젝트 자료를 찾아 원본 링크와 함께 정리해줘”처럼 요청하면 됩니다. macOS가 물으면 실행하는 터미널 또는 AI 앱의 DEVONthink 자동화 권한을 허용합니다.

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

- `DT3_DATABASE_UUIDS`가 비어 있으면 문서 접근을 허용하지 않습니다.
- 문서나 상위 그룹에 `mcp-private` 태그를 붙이면 제외됩니다. 공유 인스턴스(Replicant)의 상위 그룹 중 하나라도 비공개면 해당 문서를 차단합니다.
- 본문이 없다는 응답은 원본이 비었다는 뜻이 아닙니다. 스캔 PDF의 OCR, 미디어 전사, 압축 해제, 스프레드시트 수식 계산은 이 서버가 수행하지 않습니다.
- PDF 본문은 DEVONthink의 텍스트를 사용합니다. 전체 페이지 수는 제공하지만 본문 조각이 어느 PDF 페이지에 대응하는지는 보장하지 않습니다.
- 잠긴 문서와 외부 파일을 인덱싱한 문서는 수정하지 않습니다. 그룹 이동, 데이터베이스 간 이동, 영구 삭제도 제공하지 않습니다.
- 많은 파일을 가져올 때는 DEVONthink에서 직접 처리합니다. MCP 가져오기는 설정한 디렉터리의 파일 한 개, 최대 100 MiB로 제한됩니다.

자세한 변수와 도구 입력은 [영문 README](../README.md), 실제 검증 범위는 [검증 기록](validation.md), 최신 MCP 조사와 구현 결정은 [설계 문서](design.md)에 있습니다.

DEVONthink 4를 사용한다면 [공식 내장 MCP](https://www.devontechnologies.com/blog/20260526-devonthink-mcp-server)부터 검토하는 편이 간단합니다. 이 프로젝트는 3을 계속 사용하는 사용자를 위한 독립 구현입니다.
