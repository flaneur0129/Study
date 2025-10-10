/**
 * @OnlyCurrentDoc
 *
 * 네이버 뉴스 검색 결과를 Gemini AI로 분석하는 웹 앱의 서버 스크립트입니다.
 */

// 웹 앱을 처음 열 때 index.html 파일을 보여주는 함수
function doGet() {
  return HtmlService.createHtmlOutputFromFile('index.html')
    .setTitle('네이버 뉴스 AI 분석기')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1.0');
}

// --- API 인증 정보 ---
const NAVER_CLIENT_ID = "lrLO5M0a8yOimY1Yy79a";
const NAVER_CLIENT_SECRET = "FlrWaso5Fo";
const GEMINI_API_KEY = "AIzaSyDxp8O9lt_pjXjbzJ-ESmB0OQmgTvyhyi0";

/**
 * AI 응답 텍스트에서 순수한 JSON 부분만 추출하는 함수
 */
function extractJsonFromString(text) {
  const match = text.match(/```(json)?\s*([\s\S]*?)\s*```/);
  if (match && match[2]) return match[2].trim();
  
  const firstBracket = text.indexOf('{');
  const firstSquare = text.indexOf('[');
  let start = -1;
  
  if (firstBracket === -1) start = firstSquare;
  else if (firstSquare === -1) start = firstBracket;
  else start = Math.min(firstBracket, firstSquare);
  if (start === -1) return null;

  const lastBracket = text.lastIndexOf('}');
  const lastSquare = text.lastIndexOf(']');
  let end = Math.max(lastBracket, lastSquare);
  if (end === -1) return null;
  
  return text.substring(start, end + 1);
}

/**
 * Gemini API를 호출하는 범용 헬퍼 함수
 */
function callGeminiAPI(prompt, model) {
  if (!GEMINI_API_KEY || GEMINI_API_KEY.includes("YOUR_GEMINI_API_KEY")) {
    throw new Error("Gemini API 키가 Code.gs 파일에 설정되지 않았습니다.");
  }
  
  const userKey = Session.getTemporaryActiveUserKey();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}&quotaUser=${userKey}`;
  
  const payload = { "contents": [{ "parts": [{ "text": prompt }] }] };
  const options = { 'method': 'post', 'contentType': 'application/json', 'payload': JSON.stringify(payload), 'muteHttpExceptions': true };
  
  const maxRetries = 3;
  let delay = 1000;
  for (let i = 0; i < maxRetries; i++) {
    const response = UrlFetchApp.fetch(url, options);
    const responseCode = response.getResponseCode();
    const resultText = response.getContentText();
    if (responseCode === 200) {
      try {
        const result = JSON.parse(resultText);
        if (result.candidates && result.candidates[0].content.parts[0].text) {
          return result.candidates[0].content.parts[0].text;
        } else {
          let errorMessage = "Gemini API로부터 유효한 응답을 받지 못했습니다.";
          if (result.promptFeedback && result.promptFeedback.blockReason) {
            errorMessage += ` 이유: ${result.promptFeedback.blockReason}`;
          }
          throw new Error(errorMessage);
        }
      } catch (e) {
        throw new Error(`API 응답(JSON) 파싱 실패: ${e.message}. 원본 응답: ${resultText}`);
      }
    } else if ((responseCode === 429 || responseCode >= 500) && i < maxRetries - 1) {
      Utilities.sleep(delay + Math.random() * 1000);
      delay *= 2;
    } else {
      throw new Error(`AI 분석 API 오류 (코드: ${responseCode}): ${resultText}`);
    }
  }
  throw new Error("최대 재시도 횟수 초과. API가 계속해서 요청을 거부합니다.");
}

/**
 * 클라이언트로 호출되는 모든 서버 함수를 위한 래퍼 함수
 */
function safeExecute(func, ...args) {
  try {
    const result = func(...args);
    return result;
  } catch (e) {
    Logger.log(`Error in ${func.name}: ${e.stack}`);
    return JSON.stringify({ error: `서버 실행 오류: ${e.message}` });
  }
}

function searchNaverNews(query, startDateStr, endDateStr, totalCount) {
  return safeExecute(_searchNaverNews, query, startDateStr, endDateStr, totalCount);
}

function classifyNewsChunk(newsChunk) {
  return safeExecute(_classifyNewsChunk, newsChunk);
}

function performAdvancedAnalysis(newsData) {
  return safeExecute(_performAdvancedAnalysis, newsData);
}

function getNounsForKeywordAnalysis(newsData, searchQuery) {
  return safeExecute(_getNounsForKeywordAnalysis, newsData, searchQuery);
}

function askGeminiAboutNews(question, newsData) {
  return safeExecute(_askGeminiAboutNews, question, newsData);
}


function _searchNaverNews(query, startDateStr, endDateStr, totalCount) {
  const desiredCount = parseInt(totalCount, 10) || 10;
  if (!query || desiredCount <= 0) {
    return JSON.stringify([]);
  }
  const encodedQuery = encodeURIComponent(query);
  const allItems = [];
  let collectedCount = 0;
  
  for (let start = 1; start <= 1000 && collectedCount < desiredCount; start += 100) {
    const displayCount = Math.min(100, desiredCount - collectedCount);
    if (displayCount <= 0) break;
    const url = `https://openapi.naver.com/v1/search/news.json?query=${encodedQuery}&display=${displayCount}&start=${start}&sort=date`;
    const options = {'method': 'get', 'headers': {'X-Naver-Client-Id': NAVER_CLIENT_ID, 'X-Naver-Client-Secret': NAVER_CLIENT_SECRET}, 'muteHttpExceptions': true};
    
    const response = UrlFetchApp.fetch(url, options);
    const result = JSON.parse(response.getContentText());
    if (response.getResponseCode() === 200) {
      if (result.items && result.items.length > 0) {
        allItems.push(...result.items);
        collectedCount += result.items.length;
      } else {
        break;
      }
    } else {
      throw new Error(`Naver API Error: ${result.errorMessage || 'Unknown Error'}`);
    }
  }

  const startDate = startDateStr ? new Date(startDateStr) : null;
  if(startDate) startDate.setUTCHours(0,0,0,0);
  
  const endDate = endDateStr ? new Date(endDateStr) : null;
  if(endDate) endDate.setUTCHours(23,59,59,999);

  const filteredItems = allItems.filter(item => {
    if (!startDate && !endDate) return true;
    try {
      const itemDate = new Date(item.pubDate);
      if (isNaN(itemDate.getTime())) return false;
      const isAfterStart = startDate ? itemDate.getTime() >= startDate.getTime() : true;
      const isBeforeEnd = endDate ? itemDate.getTime() <= endDate.getTime() : true;
      return isAfterStart && isBeforeEnd;
    } catch (e) {
      return false;
    }
  });

  const finalResults = filteredItems.map(item => ({
    title: item.title.replace(/<[^>]+>/g, '').replace(/&quot;/g, '"'),
    link: item.link,
    originallink: item.originallink,
    description: item.description.replace(/<[^>]+>/g, '').replace(/&quot;/g, '"'),
    pubDate: new Date(item.pubDate).toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' })
  }));

  return JSON.stringify(finalResults);
}

function _classifyNewsChunk(newsChunk) {
  const topics = [
    "수사/조사",
    "명시적 탈세 혐의",
    "잠재적 탈세 리스크",
    "국제/역외 조세",
    "기업 세무",
    "세법/정책",
    "경제 동향",
    "비관련"
  ];
  const newsText = newsChunk.map(item => `[${item.originalIndex}] 제목: ${item.title}\n요약: ${item.description}`).join('\n---\n');
  
  const prompt = `1. 역할 및 임무 (Role & Mission)
페르소나: 당신은 대한민국 국세청(NTS) 소속의 최고 수준의 AI 세무 분석 전문가이다.
핵심 임무: 조세 정의를 수호하기 위해, 주어진 뉴스 데이터에서 잠재적인 탈세, 조세 회피, 또는 기타 세무 관련 이슈의 '가장 작은 단서'까지도 포착하는 것이다.
핵심 원칙: 기계적인 정확성(Precision)보다 **탐지율/민감도(Recall)**를 최우선으로 한다. 조금이라도 의심스럽거나 관련성이 있다면, 과감하게 관련 카테고리로 분류해야 한다. 애매한 경우는 가장 가능성이 높은 카테고리로 분류하되, 명백히 어떤 범주에도 속하지 않을 때만 '비관련'으로 판단한다.

2. 작업 절차 (Workflow)
AI는 반드시 아래의 논리적 단계를 순서대로 따라 각 뉴스 기사를 분석하고 분류해야 한다.
[1단계: 기사 이해] 기사의 제목과 요약 텍스트를 전체적으로 읽고 핵심 내용과 주제를 파악한다.
[2단계: 핵심 정보 추출] 기사에 등장하는 인물, 기업, 행위, 금액, 장소 등 핵심 개체와 그들의 관계를 파악한다.
[3단계: 분류 기준 순차 검토] 아래 3. 상세 분류 기준에 명시된 1번 '수사/조사' 카테고리부터 7번 '경제 동향' 카테고리까지 순서대로 해당하는지 검토한다. 하나의 기사가 여러 기준에 해당할 경우, 가장 앞 번호(가장 중대한 사안)의 카테고리로 분류한다.
[4단계: '비관련' 최종 판단] 위 1~7번 기준에 명확하게 해당하지 않는 경우에만, 최종적으로 '비관련'으로 분류한다.

3. 상세 분류 기준 (Detailed Classification Criteria)
1) 수사/조사
판단 기준: 사법 및 행정기관의 강제적인 조사/수사 행위가 직접적으로 언급된 경우. 탈세와 직접 관련이 없더라도, 수사 행위 자체가 중요한 정보다.
핵심 키워드: 압수수색, 조사 착수, 소환, 체포, 구속, 기소, 영장 청구, 재판, 검찰, 경찰, 공정위, 금감원 조사 등.
판단 예시: "검찰, OO기업 본사 압수수색... 횡령 혐의 포착", "국세청, 유튜버 OOO 세무조사 착수"
2) 명시적 탈세 혐의
판단 기준: 세금 탈루나 조세 회피를 위한 구체적인 행위나 혐의가 뉴스에 명시적으로 언급된 경우.
핵심 키워드: 명의대여, 차명계좌, 페이퍼컴퍼니, 자금세탁, 소득 누락, 탈루 혐의, 횡령, 배임, 분식회계, 비자금, 역외 탈세 의혹 등.
판단 예시: "차명계좌로 수십억 원대 소득 숨긴 연예인 OOO", "페이퍼컴퍼니 설립해 법인세 탈루한 중소기업 대표"
3) 잠재적 탈세 리스크 (⭐가장 중요)
판단 기준: 직접적인 탈세 언급은 없지만, 상식적으로 설명하기 어려운 자금의 흐름, 불투명한 거래 구조, 또는 세법의 허점을 이용할 개연성이 높아 보이는 정황이 포착된 경우. **'아직 드러나지 않은 위험'**을 찾아내는 것이 핵심.
핵심 단서: 자금 출처가 불분명한 고가의 자산(부동산, 미술품, 법인) 취득, 상속/증여세를 회피하기 위한 것으로 의심되는 복잡한 지배구조/순환출자, 신종 자산(가상자산, NFT)을 이용한 불투명한 거래, 공익법인 등을 통한 편법 증여/상속 정황, 사업 목적이 불분명한 해외 법인 설립.
판단 예시: "20대 연예인, 강남 100억대 빌딩 현금 매입... 자금 출처는?", "OO홀딩스, 손자회사 통해 핵심 자회사 지배... 지배구조 논란"
4) 국제/역외 조세
판단 기준: 국가 간의 거래, 자본 이동과 관련된 조세 이슈가 언급된 경우. 직접적인 탈세 언급이 없더라도 국제 조세 환경의 변화는 중요한 단서이다.
핵심 키워드: 오프쇼어, 조세피난처, 역외, 조세조약, 이전가격(Transfer Pricing), BEPS, 디지털세, 관세.
판단 예시: "구글 등 다국적 기업에 디지털세 부과 논의 급물살", "국세청, 이전가격 조작 통한 역외 탈세 집중 조사"
5) 기업 세무
판단 기준: 기업의 소유 구조나 자금 흐름에 큰 변화를 야기하는 경영 활동으로, 상속·증여·양도 등과 관련된 세무 이슈를 유발할 가능성이 있는 경우.
핵심 키워드: M&A, 인수합병, 분할, 합병, 구조조정, 지분 매각, 승계, 가업상속, 주식 양수도.
판단 예시: "A그룹, 자회사 B 흡수합병 결정... 승계 구도 영향은?", "오너 일가, 지분 매각 통해 경영권 정리"
6) 세법/정책
판단 기준: 정부 또는 국회의 세법 개정, 새로운 세금 정책 발표 등 제도 자체의 변화에 대한 보도.
핵심 키워드: 세법 개정안, 종부세, 양도세, 법인세, 소득세, 금투세, 세제 혜택, 세수, 예산, 기재부.
판단 예시: "정부, 다주택자 양도세 중과 완화 방안 발표", "내년부터 시행되는 금융투자소득세 논란"
7) 경제 동향
판단 기준: 위 1~6번 범주에 속하지 않는 일반적인 경제, 금융, 부동산 관련 뉴스로, 거시적인 세무 환경의 배경 정보로 활용될 수 있는 기사.
핵심 키워드: 금리, 환율, 주가, 부동산 시장, 물가, 수출, 투자, 경기, 고용.
판단 예시: "한국은행, 기준금리 0.25%p 추가 인상", "강남 아파트값 하락세 지속"
8) 비관련
판단 기준: 위 1~7번의 어떤 카테고리에도 명확하게 해당하지 않는 모든 기사. (예: 연예, 스포츠, 날씨, 사건사고 등)

4. 출력 형식 (Output Format)
결과는 반드시 JSON 배열 형식으로만 답해야 한다. 다른 설명은 일절 포함하지 않는다.
각 객체는 index(숫자)와 topic(문자열) 두 개의 키만을 가져야 한다.
topic 값은 위 3. 상세 분류 기준에 명시된 8가지 카테고리 중 하나여야 한다.
[출력 예시]
[
  { "index": 0, "topic": "수사/조사" },
  { "index": 1, "topic": "잠재적 탈세 리스크" }
]

[분석 대상 뉴스 데이터]
${newsText}`;
  
  const model = 'gemini-2.5-flash-lite';
  const resultText = callGeminiAPI(prompt, model);
  const cleanedText = extractJsonFromString(resultText);
  if (!cleanedText) throw new Error("AI 분류 응답에서 유효한 JSON 배열을 찾지 못했습니다.");
  
  const classifications = JSON.parse(cleanedText);
  return JSON.stringify(classifications);
}

function _performAdvancedAnalysis(newsData) {
    const ANALYSIS_LIMIT = 1000; 
    let analysisTargetData = newsData.length > ANALYSIS_LIMIT ? newsData.slice(0, ANALYSIS_LIMIT) : newsData;

    const articlesForJson = analysisTargetData.map(item => {
        const formattedDate = item.pubDate.replace(/\.\s/g, '-').replace(/\.$/, '');
        return {
            id: item.originalIndex + 1,
            date: formattedDate,
            title: item.title,
            link: item.originallink,
            summary: item.description,
            topic: item.topic || ''
        };
    });
    
    const newsArticlesJsonString = JSON.stringify({ news_articles: articlesForJson }, null, 2);

    const masterPrompt = `
Part 1: SYSTEM 프롬프트: 페르소나 및 핵심 임무
1.1. 역할 정의
- 당신은 대한민국 국세청(NTS)의 외부 컨설턴트 역할을 수행하는 최고 수준의 데이터 분석 전문가임
- 당신의 페르소나는 세법, 재무, 경제, 공공 정책에 대한 박사급 지식과 함께, 글로벌 컨설팅 펌의 파트너급 전략가의 시각을 보유함
1.2. 핵심 임무
- 뉴스 기사에서 추출한 비정형 정보를 국세청 리더십을 위한 실행 가능한 **'AI 심층 분석 보고서'**로 변환하는 것이 핵심 임무
- 직접적인 탈세 언급이 없더라도, 기사의 맥락과 개체 간의 관계를 분석하여 잠재적 혐의점을 포착하는 것이 중요함
- 최종 결과물은 최고 수준의 컨설팅 보고서와 동일한 품질과 분석 깊이를 가져야 함
1.3. 대상 독자 및 어조
- 보고서는 국세청의 정책 결정권자 및 최고위급 조사관을 대상으로 함
- 따라서, 어조는 극도로 전문적이고, 객관적이며, 간결하고, 데이터에 기반해야 함. 모든 문장은 마침표 없이 명사형으로 종결할 것

Part 2: USER 프롬프트: 마스터 지시문 및 실행 워크플로우
2.1. 전체 과업 선언
- 주어진 뉴스 기사 데이터를 기반으로, 아래 명시된 구조와 스타일 가이드를 완벽하게 준수하여 단일의 완전한 보고서를 생성할 것

2.2. 보고서 스타일 지침
- **계층 구조**: 큰 제목(##)과 작은 제목(###)을 명확히 구분하여 사용
- **형식**: 단순 나열되는 개조식 문장들은 불릿('-')을 사용하여 문장을 구분
- **문장**: 모든 문장은 마침표(.) 없이 명사형이나 동사형으로 간결하게 종결
- **강조**: 분석의 핵심이 되는 중요한 키워드나 문구는 **굵게** 처리하여 가독성을 극대화
- **분량**: 보고서의 전체 분량이 약 5페이지에 달하도록 각 섹션을 최대한 상세하고 깊이 있게 작성할 것. 특히 7번 항목은 별도의 1페이지 분량으로 할당하여 심층 분석할 것.
- **톤앤매너**: 최고 수준의 컨설팅 펌에서 사용하는 전문적이고 세련된 보고서 형식 유지

2.3. 입력 데이터 명세
- 뉴스 기사는 'news_articles' JSON 객체로 제공됨. 각 기사는 id, date, title, link, summary, topic 필드를 가짐. 특히 topic 필드는 AI 분류 분석의 결과이므로 보고서 작성 시 핵심적인 참고 자료로 활용할 것.

${newsArticlesJsonString}

2.4. 필수 내부 분석 프롬워크 (사전 분석 단계)
<thinking>
- 최종 보고서 작성 전, 다음의 내부 분석 과정을 반드시 수행하고 그 결과를 요약할 것
- 1단계: 관련성 필터링: 입력된 'topic' 분류 결과를 최우선으로 활용하여 세법/국세행정과 직접 관련된 기사 선별. '비관련'으로 분류된 기사는 제외.
- 2단계: 테마 클러스터링: 관련 기사를 핵심 주제별로 그룹화
- 3단계: 개체 식별: 기사에 등장하는 주요 기업, 기관, 인물 식별. 특히, **등장 빈도는 낮지만 탈세 혐의와 관련성이 높은 개체**를 별도로 식별하고, 일반적인 불용어(예: '국가', '국세청', '회사', '정부', '금융', '시장', '투자', '소득', '연봉' 등 AI가 판단하기에 너무 일반적이거나 맥락상 중요하지 않은 단어)는 제외
- 4단계: 중요도 평가: 국세청에 미칠 영향(세수, 정책, 조사)을 기준으로 가장 중요한 뉴스 Top 3 선정
- 5단계: 심층/특집 기사 식별: 기사 중 심층 분석, 기획, 또는 탐사 보도 성격의 기사를 식별
- 6단계: 저빈도 고영향 기사 식별: 전체 맥락에서 자주 언급되지는 않으나, 특정 탈세 혐의나 세법 허점과 직접적으로 연관된 핵심 기사 추출
- 7단계: 리스크 및 이상 징후 도출: 신종 탈세 기법, 세법 허점 등 잠재적 리스크 및 이상 징후 식별
</thinking>

2.5. 상세 출력 구조 (보고서)
- 다음 구조와 **[보고서 스타일 지침]**을 정확히 준수하여 보고서를 생성할 것. 하이퍼링크의 URL은 실제 기사 URL을 사용해야 함.
# AI 분석 보고서

## 1. 종합 브리핑
**핵심 동향**
(가장 중요한 거시적 동향을 문단 형식으로 요약. 관련 기사 번호가 있다면 [#번호](URL) 형식으로 인용)

**Top 3 뉴스 요약**
    - (가장 중요한 뉴스 3개의 핵심 내용과 그 함의를 들여쓰기하여 요약. 관련 기사 번호가 있다면 [#번호](URL))

**시사점**
(국세청이 즉시 주목해야 할 가장 중요한 리스크 및 전략적 시사점을 문단 형식으로 요약. 관련 기사 번호가 있다면 [#번호](URL))

## 2. 주요 뉴스 Top 3
### (선정된 첫 번째 뉴스 제목)
- **주요 내용**: (뉴스 내용의 핵심 요약, 관련 기사 번호 하이퍼링크 형식으로 인용 [#번호](URL))
- **선정 이유**: (해당 뉴스가 국세청의 세수, 정책, 조사 활동에 미치는 즉각적이고 중요한 영향 분석)

## 3. 주요 세무 이슈 및 동향 분석
### (분석된 첫 번째 세무 이슈)
- **현황**: (이슈의 현재 상황 및 핵심 내용 요약)
- **배경**: (이슈가 발생한 근본적인 원인 또는 배경 분석)
- **전망**: (향후 이슈가 전개될 방향 및 예상되는 변화)

## 4. 주요 개체 분석 (기업/기관/인물)
- 지시사항: 내부 분석 3단계에서 식별된 주요 개체를 **최소 5개 이상** 분석. 만약 5개 미만일 경우, 가능한 모든 개체를 분석. 불용어 및 일반 명사는 제외.
### (분석 대상 개체명)
- **개요**: (개체에 대한 핵심 설명)
- **관련 세무 이슈**: 
    - (기사에서 드러난 해당 개체와 직접 관련된 세금 문제)
- **선정 이유**: 
    - **빈도수 높음**: (자주 언급되며 주목해야 할 사항)
    - **탈세 연관성 높음**: (언급 빈도는 낮으나, 잠재적 탈세 혐의와 관련성이 높아 심층 분석이 필요한 사항)

## 5. 심층/특집 기사 분석
### (탐된 심층/특집 기사 제목)
- **기사 개요**: (해당 기사의 핵심 주장 및 내용 요약, [#번호](URL))
- **시사점**: (기사가 국세청의 정책 및 조사 활동에 던지는 핵심적인 시사점 분석)

## 6. 주요 탈세 혐의 관련 기사 (저빈도-고영향)
- 지시사항: 이 섹션은 잠재적 탈세 혐의를 직접적으로 포착하는 핵심 부분이므로, 기사 내용을 심층적으로 분석하여 구체적인 탈세 수법, 자금 흐름, 관련 인물 등을 **최대한 상세하고 입체적으로 기술할 것**. 내부 분석 6단계에서 식별된 모든 저빈도-고영향 기사를 아래 형식에 맞춰 각각의 하위 섹션으로 분석. 제목을 클릭하면 원문으로 연결되도록 링크를 걸되, URL은 텍스트에 표시하지 말 것.
### [탐지된 첫 번째 기사 제목]
- **혐의 내용**: (기사에서 암시하는 구체적인 탈세 수법 또는 세법 회피 전략 분석, [#번호](실제 URL))
- **중요성**: (해당 정보가 'Top 3 뉴스'나 '주요 동향'에서 포착되지 않았음에도 불구하고, 국세청이 주목해야 하는 이유 설명)

## 7. 잠재적 리스크 및 이상 징후
- 지시사항: **'잠재적 탈세/조세회피'로 분류된 모든 기사를 이 표에 반드시 포함하여 분석할 것**. 국세청의 실질적인 행동 계획 수립을 지원해야 함. 따라서 식별된 리스크를 유형별로 분류하고, 각 리스크가 국세청에 미칠 영향을 구체적으로 예측하며, 즉각 실행 가능한 단기 대응 방안을 **가장 구체적이고 상세하게 제시할 것**.
| 리스크 유형 | 상세 내용 및 징후 | 국세청에 미치는 영향 | 대응 방안 제언 | 원문 |
|---|---|---|---|---|
| **신종 탈세 수법** | (예: NFT를 이용한 자금 세탁 및 소득 은닉 정황 포착) | 신규 과세 영역에 대한 추적 및 과세 어려움 증대 |  관련 거래소 정보 수집 강화 | [#1](...) |
| **세법 허점** | (예: 특정 비과세 항목의 변칙적 활용 사례 증가) | 특정 계층의 합법적 조세 회피 만연, 과세 형평성 훼손 | 관련 항목에 대한 기획 점검 실시 | [#2](...) |
| **과세 인프라** | (예: AI 기반 분석 시스템 도입 지연 보도) | 탈세 패턴 조기 감지 실패, 조사 행정력 낭비 | 관련 시스템 도입 TF팀 구성 | [#3](...) |

2.6. 예시 (Few-Shot Prompting)
<example>
<example_input>
{ "news_articles": [{ "id": 21, "date": "2024-05-10", "title": "정부, 금투세 폐지 공식 추진", "link": "http://example.com/news/21", "summary": "..." }] }
</example_input>
<example_output>
## 2. 주요 뉴스 Top 3
### (정부, 금투세 폐지 공식 추진)
- **주요 내용**: 2025년 시행 예정이던 **금융투자소득세** 폐지 공식화 [#21](http://example.com/news/21)
- **선정 이유**: **수조 원대 세수 변동**을 야기하고, 국세청 과세 인프라의 존폐를 결정하는 핵심 정책 변수
</example_output>
</example>

2.7. 제약 조건 및 품질 관리
- **데이터 기반 분석**: 분석은 100% 제공된 'news_articles' 정보에만 근거해야 하며, **링크를 달 수 없는 내용은 절대 작성하지 말 것**.
- **인용 의무**: 모든 주장은 **원문 기사 하이퍼링크 형식 [#번호](실제 URL)**으로 인용하여 검증 가능성 확보
- **서문 금지**: 보고서는 서론 없이 바로 '# AI 분석 보고서' 제목으로 시작

2.8. 최종 출력 명령
- "제공된 모든 지침에 따라, 최고 수준의 컨설팅 보고서 형식으로 완전한 단일 문서의 보고서를 생성하십시오"
`;
    
    const model = 'gemini-2.5-pro';
    const resultText = callGeminiAPI(masterPrompt, model);
    return JSON.stringify({ markdown: resultText });
}


function _getNounsForKeywordAnalysis(newsData, searchQuery) {
  const ANALYSIS_LIMIT = 1000; 
  let analysisTargetData = newsData.length > ANALYSIS_LIMIT ? newsData.slice(0, ANALYSIS_LIMIT) : newsData;
  
  const newsText = analysisTargetData.map(item => item.title + ". " + item.description).join('\n');
  const searchKeywords = searchQuery.split('|').map(k => k.trim()).join(', ');
  const stopwords = "금융,주가,국채,주주,부동산,시장,거래,투자,대출,금리,시스템,상품,제품,마진,가치,경제,무역,금융시장,정책,자본,증시,실적,기술주,포트폴리오,금거래,서울,아파트,집값,규제,업체,소비자,당국,자산,달러,국감,리스크,기업,국가,것,수,위해,대한,기자,뉴스,국가,산업,정부,협상,지역,시스템,주주,주택,소득,자금,발표,공개,관련,따르면,오전,오후,지난,올해,최근,현재,관계자,전문가,대표,위원장,의원,장관,상황,수준,규모,결과,지원,추진,강화,운영,사업,대책,가운데,이번,주요,때문";
  const prompt = `주어진 텍스트에서 핵심 명사를 추출하는 임무가 주어집니다. 다음 두 단계를 따르십시오.
1. **불용어 판단 및 제거**: 먼저 텍스트 전체를 분석하여 문맥상 중요하지 않은 일반 명사, 장소, 단체 또는 너무 흔하게 사용되는 단어를 AI가 스스로 판단하여 불용어로 정의하고 목록화합니다. 이 목록에는 '${stopwords}' 및 '${searchKeywords}'가 기본적으로 포함되어야 합니다.
2. **핵심 명사 추출**: 1단계에서 식별된 불용어를 제외한 나머지 텍스트에서, 고유명사를 포함한 가장 중요하고 빈도가 높은 핵심 명사를 최대 30개까지 추출합니다.

결과는 반드시 JSON 배열 형식으로만 답해주십시오. 각 요소는 단어(word)와 빈도수(count)를 포함하는 객체여야 하며, 빈도수가 높은 순서로 정렬되어야 합니다.

[텍스트]
${newsText}`;
  
  const model = 'gemini-flash-lite-latest';
  const resultText = callGeminiAPI(prompt, model);
  const cleanedText = extractJsonFromString(resultText);
  if (!cleanedText) {
    throw new Error("AI 키워드 분석 응답에서 유효한 JSON 배열을 찾지 못했습니다.");
  }
  
  return cleanedText;
}
function _askGeminiAboutNews(question, newsData) {
  const newsText = newsData.map(item => `[기사 #${item.originalIndex + 1}] 제목: ${item.title}\n요약: ${item.description}`).join('\n\n');
  const prompt = `당신은 AI 뉴스 분석 전문가입니다. 아래에 제공된 뉴스 기사 목록만을 참고하여 사용자의 질문에 답변해주십시오.
  
[뉴스 기사 목록]
${newsText}

[사용자 질문]
${question}

답변은 반드시 제공된 뉴스 기사 내용에만 근거해야 합니다. 만약 기사에서 정보를 찾을 수 없다면, "제공된 뉴스 기사에서는 해당 정보를 찾을 수 없습니다."라고 답변해주십시오.`;

  const model = 'gemini-2.5-flash';
  const resultText = callGeminiAPI(prompt, model);
  return JSON.stringify({ answer: resultText });
}