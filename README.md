# the tree
![screenshot](https://github.com/wjdgustn/thetree/blob/master/.github/assets/screenshot.png?raw=true)

[the seed](https://theseed.io) 엔진의 시스템을 모방한 위키 엔진입니다.

the seed를 모방했으나 the seed를 완전히 동일하게 구현하는 것을 목표로 하지는 않습니다.

데모: https://testwiki.hyonsu.com

## 피드백
기능 제안, 버그 제보 등을 받고 있습니다. [이슈](https://github.com/wjdgustn/thetree/issues)에 남겨주세요.

[라이선스](#라이선스)에 따라 엔진을 직접 수정하시는 건 금지됩니다.

## 기여
프로젝트 상태, 기능의 일관성, 저작권 문제 등으로 인해 이 프로젝트에 대한 공개 기여는 받지 않을 생각입니다.

다만 스킨은 [스킨 제작 가이드](https://github.com/wjdgustn/thetree-frontend#스킨-제작-가이드)를 참고해 자유롭게 제작하실 수 있습니다.

## 라이선스
이 프로젝트는 오픈소스 라이선스를 적용하지 않으며, 별도로 명시되지 않은 부분은 레포지토리 소유자가 저작권을 보유합니다.

엔진을 위키 구동에 사용하는 것을 허가하나, 엔진 수정 및 재배포는 금지합니다.

엔진의 플러그인 기능(매크로 추가 등 가능) 사용을 원하시거나 엔진을 별도로 수정하는 등 협의를 원하시면 개인적으로 연락해주시기 바랍니다.

개발자 디스코드(빠른 확인): @hyonsu(DM을 전송할 수 없는 경우 [개인 디스코드 서버](https://discord.gg/z7pk8pWhD7) 입장)

개발자 이메일: admin@hyonsu.com

## 설치 가이드
> [!WARNING]
> MongoDB, Meilisearch 등의 상세 설치 가이드는 각 문서를 참고하세요.
> 
> 이슈에 엔진과 관련되지 않은 질문 시 통보 없이 닫기 처리될 수 있습니다.
1. git clone 명령어를 통해 엔진을 다운로드합니다.
   ```shell
   git clone https://github.com/wjdgustn/thetree
   ```
   git clone을 통해 다운로드하지 않을 경우 업데이트 기능이 작동하지 않으며, git이 설치되어있지 않으면 엔진을 구동할 수 없습니다.
1. .env.example을 .env로 복사한 뒤 내용을 채워넣습니다.
1. *.example.json을 *.json으로 복사한 뒤 내용을 채워넣습니다.
1. npm i 명령어를 통해 라이브러리를 다운로드합니다.
   ```shell
    npm i
   ```
1. [the tree frontend](https://github.com/wjdgustn/thetree-frontend) 레포지토리의 [스킨 적용 가이드]((https://github.com/wjdgustn/thetree-frontend#스킨-적용-가이드))를 참고하여 원하는 스킨을 빌드합니다.
   <br>아래는 추천하는 스킨 목록입니다.
   - [liberty](https://github.com/wjdgustn/thetree-skin-liberty)
   - [buma](https://github.com/wjdgustn/thetree-skin-buma)
1. [pm2](https://www.npmjs.com/package/pm2) 등의 자동 재시작 기능이 있는 프로세스 매니저를 사용해 main.js 파일을 구동합니다.
1. 첫 가입자에게 자동으로 소유자 권한이 부여되며, 첫 가입 시 초기 설정 페이지로 이동됩니다.
   탭을 닫은 경우 /admin/initial_setup 페이지에 직접 접속하세요.

## Docker 설치 가이드
1. [compose-full.yaml](https://github.com/wjdgustn/thetree/blob/master/.github/assets/compose-full.yaml?raw=true) 또는 [compose-min.yaml](https://github.com/wjdgustn/thetree/blob/master/.github/assets/compose-min.yaml?raw=true) 템플릿을 적절히 수정해 위키 엔진을 구동합니다.
1. /member/signup 페이지에 접속해 회원가입합니다.
1. /admin/initial_setup 페이지에서 절차에 따릅니다.

## 안내
위키 엔진에 개발자의 위키 엔진 소유자 권한 엑세스를 허용하는 기능이 내장되어 있습니다.

따라서 이슈에 버그 제보 / 질문 시 관련된 위키의 링크를 남기면 더 정확한 이슈 처리가 가능합니다.

위키 엔진 업데이트를 설치하는 것과 동일한 신뢰도를 요구한다고 생각하기 때문에 기본적으로 이 기능이 활성화되어 있으며, 기능 사용 시 감사 로그에 기록하고 있습니다.

혼자서 위키 엔진을 관리할 수 있어 이 기능을 필요로 하지 않거나, 이 기능을 신뢰할 수 없는 경우엔 devConfig.json의 disable_dev_support 값을 true로 설정하세요.

이 기능에 대한 더 자세한 설명은 [공지 문서](https://hyonsu.notion.site/the-tree-1e8862961d0d80e5b9fceb4c1ba0d7b9)를 참고하세요.

## 스킨 제작 가이드
[the tree frontend](https://github.com/wjdgustn/thetree-frontend) 레포지토리의 [스킨 제작 가이드](https://github.com/wjdgustn/thetree-frontend#스킨-제작-가이드)를 참고하세요.