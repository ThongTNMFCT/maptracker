
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
// Fix: Declare google as any to resolve "Cannot find name 'google'" errors
declare var google: any;

// Fix: Declare Window interface augmentation for window.Popup
declare global {
  interface Window {
    Popup: new (position: any, content: HTMLElement) => any;
  }
}

import {FunctionDeclaration, GoogleGenAI, Type} from '@google/genai';

const {Map} = await google.maps.importLibrary('maps');
const {LatLngBounds} = await google.maps.importLibrary('core');
const {AdvancedMarkerElement} = await google.maps.importLibrary('marker');

// Application state variables
let map: any; // Holds the Google Map instance // Type changed to any due to google:any
let points = []; // Array to store geographical points from responses
let markers = []; // Array to store map markers
let lines = []; // Array to store polylines representing routes/connections
let popUps = []; // Array to store custom popups for locations
let bounds: any; // Google Maps LatLngBounds object to fit map around points // Type changed to any
let activeCardIndex = 0; // Index of the currently selected location card
let isPlannerMode = false; // Flag to indicate if Day Planner mode is active
let dayPlanItinerary = []; // Array to hold structured items for the day plan timeline

// DOM Element references
const generateButton = document.querySelector('#generate');
const resetButton = document.querySelector('#reset');
const cardContainer = document.querySelector(
  '#card-container',
) as HTMLDivElement;
const carouselIndicators = document.querySelector(
  '#carousel-indicators',
) as HTMLDivElement;
const prevCardButton = document.querySelector(
  '#prev-card',
) as HTMLButtonElement;
const nextCardButton = document.querySelector(
  '#next-card',
) as HTMLButtonElement;
const cardCarousel = document.querySelector('.card-carousel') as HTMLDivElement;
const plannerModeToggle = document.querySelector(
  '#planner-mode-toggle',
) as HTMLInputElement;
const timelineContainer = document.querySelector(
  '#timeline-container',
) as HTMLDivElement;
const timeline = document.querySelector('#timeline') as HTMLDivElement;
const closeTimelineButton = document.querySelector(
  '#close-timeline',
) as HTMLButtonElement;
const exportPlanButton = document.querySelector(
  '#export-plan',
) as HTMLButtonElement;
const mapContainer = document.querySelector('#map-container') as HTMLElement;
const timelineToggleMobile = document.querySelector('#timeline-toggle') as HTMLButtonElement; // Renamed for clarity
const showPlanButtonDesktop = document.querySelector('#show-plan-button') as HTMLButtonElement; // New button for desktop
const mapOverlay = document.querySelector('#map-overlay') as HTMLElement;
const spinner = document.querySelector('#spinner');
const errorMessage = document.querySelector('#error-message');

// Initializes the Google Map instance and necessary libraries.
async function initMap() {
  bounds = new LatLngBounds();

  map = new Map(document.getElementById('map'), {
    center: {lat: 16.047199, lng: 108.219997}, // Default center to Da Nang, Vietnam
    zoom: 6, // Default zoom to show Vietnam
    mapId: '4504f8b37365c3d0', // Custom map ID for styling
    gestureHandling: 'greedy', // Allows easy map interaction on all devices
    zoomControl: false,
    cameraControl: false,
    mapTypeControl: false,
    scaleControl: false,
    streetViewControl: false,
    rotateControl: false,
    fullscreenControl: false,
  });

  // Define a custom Popup class extending Google Maps OverlayView.
  // This allows for custom HTML content near map markers.
  window.Popup = class CustomMapPopup extends google.maps.OverlayView {
    position: any; // google.maps.LatLng
    containerDiv: HTMLDivElement;
    constructor(position: any, content: HTMLElement) { // position type set to any
      super();
      this.position = position;
      content.classList.add('popup-bubble');

      this.containerDiv = document.createElement('div');
      this.containerDiv.classList.add('popup-container');
      this.containerDiv.appendChild(content); // Append the actual content here
      google.maps.OverlayView.preventMapHitsAndGesturesFrom(this.containerDiv);
    }

    onAdd() {
      this.getPanes!().floatPane.appendChild(this.containerDiv);
    }

    onRemove() {
      if (this.containerDiv.parentElement) {
        this.containerDiv.parentElement.removeChild(this.containerDiv);
      }
    }

    draw() {
      const divPosition = this.getProjection!().fromLatLngToDivPixel(
        this.position,
      )!;
      const display =
        Math.abs(divPosition.x) < 4000 && Math.abs(divPosition.y) < 4000
          ? 'block'
          : 'none';

      if (display === 'block') {
        this.containerDiv.style.left = divPosition.x + 'px';
        this.containerDiv.style.top = divPosition.y + 'px';
      }

      if (this.containerDiv.style.display !== display) {
        this.containerDiv.style.display = display;
      }
    }
  };
  updateTimelineControlsVisibility(); // Initial check
}

initMap();
window.addEventListener('resize', updateTimelineControlsVisibility);


const locationFunctionDeclaration: FunctionDeclaration = {
  name: 'location',
  parameters: {
    type: Type.OBJECT,
    description: 'Tọa độ địa lý của một địa điểm.',
    properties: {
      name: {type: Type.STRING, description: 'Tên của địa điểm.'},
      description: {
        type: Type.STRING,
        description:
          'Mô tả về địa điểm: tại sao nó liên quan, các chi tiết cần biết.',
      },
      lat: {type: Type.STRING, description: 'Vĩ độ của địa điểm.'},
      lng: {type: Type.STRING, description: 'Kinh độ của địa điểm.'},
      time: {
        type: Type.STRING,
        description:
          'Thời gian trong ngày để ghé thăm địa điểm này (ví dụ: "09:00", "14:30"). Quan trọng cho Chế độ Lập kế hoạch Hàng ngày.',
      },
      duration: {
        type: Type.STRING,
        description:
          'Thời gian lưu trú đề xuất tại địa điểm này (ví dụ: "1 giờ", "45 phút"). Quan trọng cho Chế độ Lập kế hoạch Hàng ngày.',
      },
      sequence: {
        type: Type.NUMBER,
        description:
          'Thứ tự trong lịch trình trong ngày (1 = điểm dừng đầu tiên trong ngày). Thứ tự này áp dụng cho mỗi ngày đối với kế hoạch nhiều ngày. Quan trọng cho Chế độ Lập kế hoạch Hàng ngày.',
      },
      day: {
        type: Type.NUMBER,
        description:
          'Số thứ tự ngày trong lịch trình (ví dụ: 1 cho Ngày 1, 2 cho Ngày 2). Bắt buộc cho kế hoạch nhiều ngày, mặc định là 1 nếu không phải kế hoạch nhiều ngày.',
      },
    },
    required: ['name', 'description', 'lat', 'lng'],
  },
};

const lineFunctionDeclaration: FunctionDeclaration = {
  name: 'line',
  parameters: {
    type: Type.OBJECT,
    description: 'Kết nối giữa một địa điểm bắt đầu và một địa điểm kết thúc.',
    properties: {
      name: {
        type: Type.STRING,
        description: 'Tên của tuyến đường hoặc kết nối.',
      },
      start: {
        type: Type.OBJECT,
        description: 'Địa điểm bắt đầu của tuyến đường.',
        properties: {
          lat: {
            type: Type.STRING,
            description: 'Vĩ độ của địa điểm bắt đầu.',
          },
          lng: {
            type: Type.STRING,
            description: 'Kinh độ của địa điểm bắt đầu.',
          },
        },
      },
      end: {
        type: Type.OBJECT,
        description: 'Địa điểm kết thúc của tuyến đường.',
        properties: {
          lat: {
            type: Type.STRING,
            description: 'Vĩ độ của địa điểm kết thúc.',
          },
          lng: {
            type: Type.STRING,
            description: 'Kinh độ của địa điểm kết thúc.',
          },
        },
      },
      transport: {
        type: Type.STRING,
        description:
          'Phương tiện di chuyển giữa các địa điểm (ví dụ: "đi bộ", "lái xe", "phương tiện công cộng"). Quan trọng cho Chế độ Lập kế hoạch Hàng ngày.',
      },
      travelTime: {
        type: Type.STRING,
        description:
          'Thời gian di chuyển ước tính giữa các địa điểm (ví dụ: "15 phút", "1 giờ"). Quan trọng cho Chế độ Lập kế hoạch Hàng ngày.',
      },
      day: {
        type: Type.NUMBER,
        description:
          'Số thứ tự ngày mà đoạn di chuyển này thuộc về (ví dụ: 1 cho Ngày 1, 2 cho Ngày 2). Bắt buộc cho kế hoạch nhiều ngày, mặc định là 1 nếu không phải kế hoạch nhiều ngày.',
      },
    },
    required: ['name', 'start', 'end'],
  },
};

const systemInstructions = `## Hướng dẫn Hệ thống cho Trình khám phá Bản đồ Tương tác

**Vai trò của Mô hình:** Bạn là một trợ lý am hiểu, có kiến thức về địa lý, cung cấp thông tin trực quan thông qua bản đồ.
Mục tiêu chính của bạn là trả lời toàn diện mọi truy vấn liên quan đến địa điểm, sử dụng hình ảnh hóa dựa trên bản đồ.
Bạn có thể xử lý thông tin về hầu hết mọi địa điểm, có thật hoặc hư cấu, trong quá khứ, hiện tại hoặc tương lai.

**Khả năng Cốt lõi:**

1.  **Kiến thức Địa lý:** Bạn sở hữu kiến thức sâu rộng về:
    *   Các địa điểm, danh lam thắng cảnh và điểm thu hút trên toàn cầu.
    *   Các di tích lịch sử và ý nghĩa của chúng.
    *   Các kỳ quan thiên nhiên và địa lý.
    *   Các điểm văn hóa nổi bật.
    *   Các tuyến đường du lịch và lựa chọn phương tiện di chuyển.

2.  **Hai Chế độ Hoạt động:**

    **A. Chế độ Khám phá Chung** (Mặc định khi DAY_PLANNER_MODE là false):
    *   Đáp ứng mọi truy vấn bằng cách xác định các địa điểm địa lý liên quan.
    *   Hiển thị nhiều điểm quan tâm liên quan đến truy vấn.
    *   Cung cấp mô tả phong phú cho mỗi địa điểm.
    *   Kết nối các địa điểm liên quan bằng các đường dẫn thích hợp.
    *   Tập trung vào việc cung cấp thông tin hơn là lên lịch trình.

    **B. Chế độ Lập kế hoạch Hàng ngày** (Khi DAY_PLANNER_MODE là true):
    *   **YÊU CẦU CỐT LÕI TRONG CHẾ ĐỘ NÀY:** Phản hồi của bạn **CHỈ ĐƯỢC PHÉP** chứa các lệnh gọi hàm \`location\` và \`line\` thông qua cơ chế tool/function calling. **TUYỆT ĐỐI KHÔNG** được trả về bất kỳ văn bản tự do, giải thích, lời chào, hay thông báo lỗi nào dưới dạng văn bản. Nếu bạn không thể tạo một kế hoạch chi tiết dựa trên yêu cầu, bạn **PHẢI** trả về một luồng (stream) không chứa bất kỳ lệnh gọi hàm nào, thay vì gửi một tin nhắn văn bản.
    *   Tạo lịch trình chi tiết có thể kéo dài một hoặc nhiều ngày dựa trên yêu cầu của người dùng.
    *   Nếu người dùng yêu cầu kế hoạch nhiều ngày (ví dụ: "chuyến đi 3 ngày đến Paris", "cuối tuần ở London", "3 ngày ở An Giang"), hãy cấu trúc đầu ra tương ứng.
    *   Đối với mỗi địa điểm và đoạn di chuyển trong kế hoạch nhiều ngày, bạn **PHẢI** bao gồm thuộc tính \`day\` cho biết nó thuộc ngày nào trong lịch trình (ví dụ: day: 1, day: 2). Đối với kế hoạch một ngày, \`day: 1\` là phù hợp.
    *   Tạo một chuỗi các địa điểm hợp lý để tham quan cho mỗi ngày (thường là 4-6 điểm dừng chính mỗi ngày).
    *   Bao gồm thời gian cụ thể và thời lượng thực tế cho mỗi lượt tham quan địa điểm.
    *   Bao gồm các tuyến đường di chuyển giữa các địa điểm với các phương thức vận chuyển phù hợp.
    *   Đảm bảo lịch trình cân bằng cho mỗi ngày, xem xét thời gian di chuyển, nghỉ ngơi ăn uống và thời gian tham quan.
    *   Mỗi địa điểm **PHẢI** bao gồm các thuộc tính \`time\` (thời gian), \`duration\` (thời lượng), và \`sequence\` (thứ tự trong ngày đó).
    *   Mỗi đường \`line\` kết nối các địa điểm phải bao gồm các thuộc tính \`transport\` (phương tiện) và \`travelTime\` (thời gian di chuyển), và \`day\` nếu là một phần của kế hoạch nhiều ngày.

**Định dạng Đầu ra:**

1.  **Chế độ Khám phá Chung:**
    *   Sử dụng hàm \`location\` cho mỗi điểm quan tâm liên quan với các thuộc tính \`name\` (tên), \`description\` (mô tả), \`lat\` (vĩ độ), \`lng\` (kinh độ).
    *   Sử dụng hàm \`line\` để kết nối các địa điểm liên quan nếu thích hợp.
    *   Cung cấp càng nhiều địa điểm thú vị càng tốt (lý tưởng là 4-8 địa điểm).
    *   Đảm bảo mỗi địa điểm có mô tả ý nghĩa.

2.  **Chế độ Lập kế hoạch Hàng ngày:**
    *   Đầu ra của bạn **BẮT BUỘC VÀ CHỈ DUY NHẤT** là một chuỗi các lệnh gọi hàm \`location\` và \`line\` được trả về thông qua cơ chế tool/function calling của API. Không được có bất kỳ văn bản nào khác trong phản hồi. Ví dụ, nếu người dùng yêu cầu "lên kế hoạch 3 ngày ở NơiKhôngTồnTại", và bạn không thể tạo kế hoạch, bạn **PHẢI** trả về một stream không có lệnh gọi hàm nào. **KHÔNG** được gửi lại một tin nhắn văn bản như "Tôi không thể tìm thấy NơiKhôngTồnTại".
    *   Sử dụng hàm \`location\` cho mỗi điểm dừng với các thuộc tính bắt buộc: \`time\`, \`duration\`, \`sequence\`, và \`day\` (bắt buộc cho nhiều ngày).
    *   Sử dụng hàm \`line\` để kết nối các điểm dừng với các thuộc tính \`transport\`, \`travelTime\`, và \`day\` (bắt buộc cho nhiều ngày). Đặt tên cho các đường \`line\` một cách mô tả, ví dụ: "Di chuyển từ [Địa điểm A] đến [Địa điểm B] vào Ngày X".
    *   Cấu trúc mỗi ngày theo một trình tự hợp lý với thời gian thực tế.
    *   **Ví dụ quan trọng bằng tiếng Việt:** Nếu người dùng nhập một truy vấn như: "lên kế hoạch 2 ngày ở Huế", bạn PHẢI tạo ra một chuỗi các lệnh gọi hàm (function calls) như sau, chứ KHÔNG PHẢI văn bản tự do:
        \`\`\`json
        [
          {"functionCall": {"name": "location", "args": {"name": "Kinh Thành Huế", "description": "Tham quan các cung điện, đền đài trong Đại Nội.", "lat": "16.467123", "lng": "107.578012", "time": "09:00", "duration": "3 giờ", "sequence": 1, "day": 1}}},
          {"functionCall": {"name": "location", "args": {"name": "Chùa Thiên Mụ", "description": "Ngôi chùa cổ kính bên bờ sông Hương.", "lat": "16.450555", "lng": "107.547888", "time": "14:00", "duration": "1.5 giờ", "sequence": 2, "day": 1}}},
          {"functionCall": {"name": "line", "args": {"name": "Di chuyển từ Kinh Thành Huế đến Chùa Thiên Mụ - Ngày 1", "start": {"lat": "16.467123", "lng": "107.578012"}, "end": {"lat": "16.450555", "lng": "107.547888"}, "transport": "taxi", "travelTime": "15 phút", "day": 1}}},
          {"functionCall": {"name": "location", "args": {"name": "Lăng Khải Định", "description": "Lăng mộ với kiến trúc kết hợp Đông Tây.", "lat": "16.396999", "lng": "107.583222", "time": "10:00", "duration": "2 giờ", "sequence": 1, "day": 2}}}
        ]
        \`\`\`
        Lưu ý: Đây chỉ là một ví dụ rút gọn. Một kế hoạch đầy đủ sẽ có nhiều địa điểm và tuyến đường hơn cho mỗi ngày. Điều quan trọng là bạn phải gọi các hàm \`location\` và \`line\` với đầy đủ các tham số được yêu cầu, đặc biệt là \`day\` cho kế hoạch nhiều ngày.

**Hướng dẫn Quan trọng:**
*   Đối với BẤT KỲ truy vấn nào, luôn cung cấp dữ liệu địa lý thông qua hàm \`location\`.
*   Nếu không chắc chắn về một địa điểm cụ thể, hãy sử dụng phán đoán tốt nhất của bạn để cung cấp tọa độ.
*   Không bao giờ trả lời chỉ bằng câu hỏi hoặc yêu cầu làm rõ.
*   Luôn cố gắng hiển thị thông tin trực quan trên bản đồ, ngay cả đối với các truy vấn phức tạp hoặc trừu tượng.
*   Đối với kế hoạch trong ngày, tạo lịch trình thực tế bắt đầu không sớm hơn 8:00 sáng và kết thúc trước 9:00 tối cho mỗi ngày.

Hãy nhớ: Ở chế độ mặc định, hãy đáp ứng MỌI truy vấn bằng cách tìm các địa điểm liên quan để hiển thị trên bản đồ, ngay cả khi không rõ ràng về du lịch hoặc địa lý. Ở chế độ lập kế hoạch hàng ngày, hãy tạo lịch trình có cấu trúc, có khả năng kéo dài nhiều ngày nếu được yêu cầu, và ƯU TIÊN trả về dưới dạng function calls như ví dụ đã cung cấp.`;

const ai = new GoogleGenAI({apiKey: process.env.API_KEY});

function updateTimelineControlsVisibility() {
  const timelineIsEffectivelyOpen = timelineContainer?.classList.contains('visible');
  const planExistsAndPlannerMode = isPlannerMode && dayPlanItinerary.length > 0;

  // Desktop "Show Plan" button
  if (showPlanButtonDesktop) {
    if (planExistsAndPlannerMode && !timelineIsEffectivelyOpen && window.innerWidth > 768) {
      showPlanButtonDesktop.style.display = 'flex';
    } else {
      showPlanButtonDesktop.style.display = 'none';
    }
  }

  // Mobile timeline toggle button
  if (timelineToggleMobile) {
    if (planExistsAndPlannerMode && !timelineIsEffectivelyOpen && window.innerWidth <= 768) {
      timelineToggleMobile.style.display = 'flex';
    } else {
      timelineToggleMobile.style.display = 'none';
    }
  }
}


function showTimeline() {
  if (timelineContainer && dayPlanItinerary.length > 0) { // Ensure plan exists
    timelineContainer.style.display = 'block';
    setTimeout(() => {
      timelineContainer.classList.add('visible');
      if (window.innerWidth > 768) {
        mapContainer.classList.add('map-container-shifted');
        adjustInterfaceForTimeline(true);
      } else {
        mapOverlay.classList.add('visible');
      }
       map.fitBounds(bounds);
    }, 10);
  }
  updateTimelineControlsVisibility();
}

function hideTimeline() {
  if (timelineContainer) {
    timelineContainer.classList.remove('visible');
    updateTimelineControlsVisibility();

    mapContainer.classList.remove('map-container-shifted');
    mapOverlay.classList.remove('visible');
    adjustInterfaceForTimeline(false);
    setTimeout(() => {
      timelineContainer.style.display = 'none';
      map.fitBounds(bounds);
    }, 300);
  } else {
     updateTimelineControlsVisibility();
  }
}

function adjustInterfaceForTimeline(isTimelineVisible: boolean) {
  setTimeout(() => {
    if (bounds && map) {
      map.fitBounds(bounds);
    }
  }, 350);
}

const promptInput = document.querySelector(
  '#prompt-input',
) as HTMLTextAreaElement;
promptInput.addEventListener('keydown', (e: KeyboardEvent) => {
  if (e.code === 'Enter' && !e.shiftKey) {
    const buttonEl = document.getElementById('generate') as HTMLButtonElement;
    buttonEl.classList.add('loading');
    e.preventDefault();
    e.stopPropagation();
    setTimeout(() => {
      sendText(promptInput.value);
      promptInput.value = '';
    }, 10);
  }
});

generateButton.addEventListener('click', (e) => {
  const buttonEl = e.currentTarget as HTMLButtonElement;
  buttonEl.classList.add('loading');
  setTimeout(() => {
    sendText(promptInput.value);
  }, 10);
});

resetButton.addEventListener('click', (e) => {
  restart();
});

if (prevCardButton) {
  prevCardButton.addEventListener('click', () => {
    navigateCards(-1);
  });
}

if (nextCardButton) {
  nextCardButton.addEventListener('click', () => {
    navigateCards(1);
  });
}

if (plannerModeToggle) {
  plannerModeToggle.addEventListener('change', () => {
    isPlannerMode = plannerModeToggle.checked;
    promptInput.placeholder = isPlannerMode
      ? "Tạo kế hoạch du lịch... (ví dụ: '1 ngày ở Hà Nội', '3 ngày khám phá Đà Nẵng')"
      : "Khám phá địa điểm, lịch sử, sự kiện hoặc hỏi về bất kỳ vị trí nào...";
    if (!isPlannerMode && timelineContainer?.classList.contains('visible')) {
      hideTimeline();
    }
    updateTimelineControlsVisibility();
  });
}

if (closeTimelineButton) {
  closeTimelineButton.addEventListener('click', () => {
    hideTimeline();
  });
}

if (timelineToggleMobile) {
  timelineToggleMobile.addEventListener('click', () => {
    showTimeline();
  });
}

if (showPlanButtonDesktop) {
    showPlanButtonDesktop.addEventListener('click', () => {
        showTimeline();
    });
}

if (mapOverlay) {
  mapOverlay.addEventListener('click', () => {
    hideTimeline();
  });
}

if (exportPlanButton) {
  exportPlanButton.addEventListener('click', () => {
    exportDayPlan();
  });
}

function restart() {
  points = [];
  bounds = new google.maps.LatLngBounds();
  dayPlanItinerary = [];
  markers.forEach((marker: any) => marker.setMap(null));
  markers = [];
  lines.forEach((line: any) => {
    line.poly.setMap(null);
    line.geodesicPoly.setMap(null);
  });
  lines = [];
  popUps.forEach((popup: any) => {
    popup.popup.setMap(null);
    if (popup.content && popup.content.remove) popup.content.remove();
  });
  popUps = [];
  if (cardContainer) cardContainer.innerHTML = '';
  if (carouselIndicators) carouselIndicators.innerHTML = '';
  if (cardCarousel) cardCarousel.style.display = 'none';
  if (timeline) timeline.innerHTML = '';
  if (timelineContainer?.classList.contains('visible')) hideTimeline();
  const timelineHeaderTitle = document.querySelector('.timeline-header h3');
  if (timelineHeaderTitle) {
      timelineHeaderTitle.textContent = 'Lịch Trình Của Bạn';
  }
  updateTimelineControlsVisibility();
}

async function sendText(prompt: string) {
  spinner.classList.remove('hidden');
  errorMessage.innerHTML = '';
  restart();
  const buttonEl = document.getElementById('generate') as HTMLButtonElement;

  let accumulatedTextFromModel = '';
  let results = false;

  try {
    const finalPrompt = prompt;

    const updatedInstructions = isPlannerMode
      ? systemInstructions.replace('DAY_PLANNER_MODE', 'true')
      : systemInstructions.replace('DAY_PLANNER_MODE', 'false');

    const response = await ai.models.generateContentStream({
      model: 'gemini-2.5-flash-preview-04-17',
      contents: finalPrompt,
      config: {
        systemInstruction: updatedInstructions,
        temperature: isPlannerMode ? 0.2 : 1.0,
        tools: [
          {
            functionDeclarations: [
              locationFunctionDeclaration,
              lineFunctionDeclaration,
            ],
          },
        ],
      },
    });

    for await (const chunk of response) {
      const fns = chunk.functionCalls ?? [];

      if (fns.length > 0) {
        for (const fn of fns) {
          if (fn.name === 'location') {
            await setPin(fn.args);
            results = true;
          }
          if (fn.name === 'line') {
            await setLeg(fn.args);
            results = true;
          }
        }
      } else if (isPlannerMode && chunk.text && chunk.text.trim() !== '') {
        // In planner mode, we don't expect text chunks without function calls.
        // Log this as it indicates the model is not strictly adhering.
        console.warn("Planner Mode: Received text chunk without function calls:", chunk.text);
      }
      
      // Accumulate all text content from the stream for debugging purposes.
      if (chunk.text) {
        accumulatedTextFromModel += chunk.text;
      }
    }

    if (!results) {
      // If no function calls were processed, log any accumulated text from the model.
      // This text might explain why the model couldn't generate the plan.
      if (accumulatedTextFromModel.trim() !== '') {
        console.error("Không có function call nào được xử lý. Model đã trả về văn bản sau:", accumulatedTextFromModel.trim());
      }
      throw new Error(
        'Không thể tạo kết quả nào. Vui lòng thử lại hoặc thử một gợi ý khác.',
      );
    }

    if (isPlannerMode && dayPlanItinerary.length > 0) {
      dayPlanItinerary.sort(
        (a: any, b: any) =>
          (a.day || 1) - (b.day || 1) ||
          (a.sequence || Infinity) - (b.sequence || Infinity) ||
          (a.time || '').localeCompare(b.time || ''),
      );
      createTimeline();
      showTimeline();
    } else {
      updateTimelineControlsVisibility();
    }

    createLocationCards();
  } catch (e: any) {
    errorMessage.innerHTML = e.message;
    // console.error already happens if !results, but keep this for other potential errors
    if (results && e.message !== 'Không thể tạo kết quả nào. Vui lòng thử lại hoặc thử một gợi ý khác.') {
        console.error('Error generating content:', e);
    }
    updateTimelineControlsVisibility();
  } finally {
    buttonEl.classList.remove('loading');
  }
  spinner.classList.add('hidden');
}

async function setPin(args: any) {
  const point = {lat: Number(args.lat), lng: Number(args.lng)};
  points.push(point);
  bounds.extend(point);

  const marker = new AdvancedMarkerElement({
    map,
    position: point,
    title: args.name,
  });
  markers.push(marker);
  map.panTo(point);
  map.fitBounds(bounds);

  const content = document.createElement('div');
  let timeInfo = '';
  if (args.time) {
    timeInfo = `<div style="margin-top: 4px; font-size: 12px; color: #2196F3;">
                  <i class="fas fa-clock"></i> ${args.time}
                  ${args.duration ? ` • ${args.duration}` : ''}
                </div>`;
  }
  content.innerHTML = `<b>${args.name}</b><br/>${args.description}${timeInfo}`;
  const popup = new window.Popup(new google.maps.LatLng(point), content);

  if (!isPlannerMode) {
    (popup as any).setMap(map);
  }

  const locationInfo = {
    name: args.name,
    description: args.description,
    position: new google.maps.LatLng(point),
    popup,
    content,
    time: args.time,
    duration: args.duration,
    sequence: args.sequence,
    day: args.day || 1,
  };

  popUps.push(locationInfo);

  if (isPlannerMode) {
    dayPlanItinerary.push(locationInfo);
  }
}

async function setLeg(args: any) {
  const start = {
    lat: Number(args.start.lat),
    lng: Number(args.start.lng),
  };
  const end = {lat: Number(args.end.lat), lng: Number(args.end.lng)};
  points.push(start);
  points.push(end);
  bounds.extend(start);
  bounds.extend(end);
  map.fitBounds(bounds);

  const polyOptions = {
    strokeOpacity: 0.0,
    strokeWeight: 3,
    map,
  };

  const geodesicPolyOptions = {
    strokeColor: isPlannerMode ? '#2196F3' : '#CC0099',
    strokeOpacity: 1.0,
    strokeWeight: isPlannerMode ? 4 : 3,
    map,
  };

  if (isPlannerMode) {
    (geodesicPolyOptions as any)['icons'] = [
      {
        icon: {path: 'M 0,-1 0,1', strokeOpacity: 1, scale: 3},
        offset: '0',
        repeat: '15px',
      },
    ];
  }
  const poly = new google.maps.Polyline(polyOptions);
  const geodesicPoly = new google.maps.Polyline(geodesicPolyOptions);

  const path = [start, end];
  poly.setPath(path);
  geodesicPoly.setPath(path);

  lines.push({
    poly,
    geodesicPoly,
    name: args.name,
    transport: args.transport,
    travelTime: args.travelTime,
    day: args.day || 1,
    args: { start: args.start, end: args.end }
  });
}

function createTimeline() {
  if (!timeline || dayPlanItinerary.length === 0) return;
  timeline.innerHTML = '';

  dayPlanItinerary.sort(
    (a: any, b: any) =>
      (a.day || 1) - (b.day || 1) ||
      (a.sequence || Infinity) - (b.sequence || Infinity) ||
      (a.time || '').localeCompare(b.time || '')
  );

  const groupedByDay = dayPlanItinerary.reduce((acc, item: any) => {
    const day = item.day || 1;
    if (!acc[day]) acc[day] = [];
    acc[day].push(item);
    return acc;
  }, {} as Record<number, any[]>);

  const sortedDays = Object.keys(groupedByDay).map(Number).sort((a, b) => a - b);

  const timelineHeaderTitle = document.querySelector('.timeline-header h3');
  if (timelineHeaderTitle) {
    if (sortedDays.length > 1) {
      timelineHeaderTitle.textContent = `Kế hoạch ${sortedDays.length} Ngày Của Bạn`;
    } else {
      timelineHeaderTitle.textContent = 'Kế hoạch Trong Ngày Của Bạn';
    }
  }

  for (const day of sortedDays) {
    const itemsForDay = groupedByDay[day];

    const dayHeader = document.createElement('div');
    dayHeader.className = 'timeline-day-header';
    dayHeader.innerHTML = `<h3>Ngày ${day}</h3>`;
    timeline.appendChild(dayHeader);

    for (let i = 0; i < itemsForDay.length; i++) {
      const item = itemsForDay[i];
      const timelineItem = document.createElement('div');
      timelineItem.className = 'timeline-item';
      const timeDisplay = item.time || 'Linh hoạt';

      timelineItem.innerHTML = `
        <div class="timeline-time">${timeDisplay}</div>
        <div class="timeline-connector">
          <div class="timeline-dot"></div>
          <div class="timeline-line"></div>
        </div>
        <div class="timeline-content" data-location-name="${item.name}" data-day="${item.day || 1}" data-sequence="${item.sequence}">
          <div class="timeline-title">${item.name}</div>
          <div class="timeline-description">${item.description}</div>
          ${item.duration ? `<div class="timeline-duration">${item.duration}</div>` : ''}
        </div>
      `;

      const timelineContent = timelineItem.querySelector('.timeline-content');
      if (timelineContent) {
        timelineContent.addEventListener('click', () => {
          const clickedDay = parseInt((timelineContent as HTMLElement).getAttribute('data-day') || '1');
          const clickedSeq = parseInt((timelineContent as HTMLElement).getAttribute('data-sequence') || '0');
          const clickedName = (timelineContent as HTMLElement).getAttribute('data-location-name');

          const popupIndex = popUps.findIndex((p: any) =>
              p.name === clickedName &&
              (p.day || 1) === clickedDay &&
              p.sequence === clickedSeq
          );
          if (popupIndex !== -1) {
            highlightCard(popupIndex);
            map.panTo((popUps[popupIndex] as any).position);
          }
        });
      }
      timeline.appendChild(timelineItem);

      if (i < itemsForDay.length - 1) {
        const nextItem = itemsForDay[i + 1];
        const connectingLine = lines.find((line: any) => {
          if ((line.day || 1) !== (item.day || 1)) return false;
          if (line.args && line.args.start && line.args.end) {
             const startMatch = Math.abs(Number(line.args.start.lat) - item.position.lat()) < 0.0001 && Math.abs(Number(line.args.start.lng) - item.position.lng()) < 0.0001;
             const endMatch = Math.abs(Number(line.args.end.lat) - nextItem.position.lat()) < 0.0001 && Math.abs(Number(line.args.end.lng) - nextItem.position.lng()) < 0.0001;
             if (startMatch && endMatch) return true;
          }
          const lineName = line.name.toLowerCase();
          const currentItemName = item.name.toLowerCase();
          const nextItemName = nextItem.name.toLowerCase();
          return lineName.includes(currentItemName) && lineName.includes(nextItemName);
        }) as any;

        if (connectingLine && (connectingLine.transport || connectingLine.travelTime)) {
          const transportItem = document.createElement('div');
          transportItem.className = 'timeline-item transport-item';
          transportItem.innerHTML = `
            <div class="timeline-time"></div>
            <div class="timeline-connector">
              <div class="timeline-dot" style="background-color: #999; width: 8px; height: 8px; margin-top:6px;"></div>
              <div class="timeline-line"></div>
            </div>
            <div class="timeline-content transport">
              <div class="timeline-title">
                <i class="fas fa-${getTransportIcon(connectingLine.transport || 'route')}"></i>
                ${connectingLine.transport || 'Di chuyển'}
              </div>
              <div class="timeline-description">${connectingLine.name}</div>
              ${connectingLine.travelTime ? `<div class="timeline-duration">${connectingLine.travelTime}</div>` : ''}
            </div>
          `;
          timeline.appendChild(transportItem);
        }
      }
    }
  }

  const allTimelineItems = timeline.querySelectorAll('.timeline-item');
  if (allTimelineItems.length > 0) {
      const lastItemConnectorLine = allTimelineItems[allTimelineItems.length - 1].querySelector('.timeline-line');
      if (lastItemConnectorLine) {
         (lastItemConnectorLine as HTMLElement).style.display = 'none';
      }
  }
}


function getTransportIcon(transportType: string): string {
  const type = (transportType || '').toLowerCase();
  if (type.includes('walk') || type.includes('đi bộ')) return 'walking';
  if (type.includes('car') || type.includes('driv') || type.includes('ô tô') || type.includes('xe hơi')) return 'car-side';
  if (type.includes('bus') || type.includes('transit') || type.includes('public')|| type.includes('xe buýt')) return 'bus-alt';
  if (type.includes('train') || type.includes('subway') || type.includes('metro') || type.includes('tàu hỏa') || type.includes('tàu điện')) return 'train';
  if (type.includes('bike') || type.includes('cycl') || type.includes('xe đạp')) return 'bicycle';
  if (type.includes('taxi') || type.includes('cab')) return 'taxi';
  if (type.includes('boat') || type.includes('ferry') || type.includes('thuyền') || type.includes('phà')) return 'ship';
  if (type.includes('plane') || type.includes('fly') || type.includes('máy bay')) return 'plane-departure';
  return 'route';
}

function createLocationCards() {
  if (!cardContainer || !carouselIndicators || popUps.length === 0) return;
  cardContainer.innerHTML = '';
  carouselIndicators.innerHTML = '';
  cardCarousel.style.display = 'block';

  const isMultiDayPlan = popUps.some((p:any) => p.day && p.day > 1);

  popUps.forEach((location: any, index) => {
    const card = document.createElement('div');
    card.className = 'location-card';
    if (isPlannerMode) card.classList.add('day-planner-card');
    if (index === 0) card.classList.add('card-active');

    let cardContent = `<div class="card-image"></div>`;

    if (isPlannerMode) {
      if (location.sequence) {
        let badgeText = `${location.sequence}`;
        if (isMultiDayPlan) {
            badgeText = `Ngày ${location.day || 1}-${location.sequence}`;
        }
        cardContent += `<div class="card-sequence-badge">${badgeText}</div>`;
      }
      if (location.time) {
        cardContent += `<div class="card-time-badge">${location.time}</div>`;
      }
    }

    cardContent += `
      <div class="card-content">
        <h3 class="card-title">${location.name}</h3>
        <p class="card-description">${location.description}</p>
        ${isPlannerMode && location.duration ? `<div class="card-duration">${location.duration}</div>` : ''}
        <div class="card-coordinates">
          ${location.position.lat().toFixed(5)}, ${location.position.lng().toFixed(5)}
        </div>
      </div>
    `;
    card.innerHTML = cardContent;

    card.addEventListener('click', () => {
      highlightCard(index);
      map.panTo(location.position);
      if (isPlannerMode && timeline) highlightTimelineItem(index);
    });

    cardContainer.appendChild(card);

    const dot = document.createElement('div');
    dot.className = 'carousel-dot';
    if (index === 0) dot.classList.add('active');
    carouselIndicators.appendChild(dot);
  });

  if (cardCarousel && popUps.length > 0) {
    cardCarousel.style.display = 'block';
  }
}

function highlightCard(index: number) {
  activeCardIndex = index;
  const cards = cardContainer?.querySelectorAll('.location-card');
  if (!cards) return;

  cards.forEach((card) => card.classList.remove('card-active'));
  if (cards[index]) {
    cards[index].classList.add('card-active');
    const cardElement = cards[index] as HTMLElement;
    const cardWidth = cardElement.offsetWidth;
    const containerWidth = cardContainer.offsetWidth;
    const scrollPosition =
      cardElement.offsetLeft - containerWidth / 2 + cardWidth / 2;
    cardContainer.scrollTo({left: scrollPosition, behavior: 'smooth'});
  }

  const dots = carouselIndicators?.querySelectorAll('.carousel-dot');
  if (dots) {
    dots.forEach((dot, i) => dot.classList.toggle('active', i === index));
  }

  popUps.forEach((popup: any, i) => {
    popup.popup.setMap(isPlannerMode ? (i === index ? map : null) : map);
    if (popup.content) {
      popup.content.classList.toggle('popup-active', i === index);
    }
  });

  if (isPlannerMode) highlightTimelineItem(index);
}

function highlightTimelineItem(cardIndex: number) {
  if (!timeline) return;
  const timelineItems = timeline.querySelectorAll(
    '.timeline-content:not(.transport)',
  );
  timelineItems.forEach((item) => item.classList.remove('active'));

  const location = popUps[cardIndex] as any;
  if (!location) return;

  for (const item of timelineItems) {
    const itemDay = parseInt(item.getAttribute('data-day') || '1');
    const itemSequence = parseInt(item.getAttribute('data-sequence') || '0');
    const itemName = item.getAttribute('data-location-name');

    if (itemName === location.name && (location.day || 1) === itemDay && location.sequence === itemSequence) {
      item.classList.add('active');
      (item as HTMLElement).scrollIntoView({behavior: 'smooth', block: 'nearest'});
      break;
    }
  }
}

function navigateCards(direction: number) {
  const newIndex = activeCardIndex + direction;
  if (newIndex >= 0 && newIndex < popUps.length) {
    highlightCard(newIndex);
    map.panTo((popUps[newIndex] as any).position);
  }
}

function exportDayPlan() {
  if (!dayPlanItinerary.length) return;

  dayPlanItinerary.sort(
    (a: any, b: any) =>
      (a.day || 1) - (b.day || 1) ||
      (a.sequence || Infinity) - (b.sequence || Infinity) ||
      (a.time || '').localeCompare(b.time || '')
  );

  const groupedByDay = dayPlanItinerary.reduce((acc, item: any) => {
    const day = item.day || 1;
    if (!acc[day]) acc[day] = [];
    acc[day].push(item);
    return acc;
  }, {} as Record<number, any[]>);

  const sortedDays = Object.keys(groupedByDay).map(Number).sort((a, b) => a - b);

  let content = '';
  let fileName = 'ke-hoach.txt';

  if (sortedDays.length > 1) {
    content += `# Kế hoạch ${sortedDays.length} Ngày Của Bạn\n\n`;
    fileName = `ke-hoach-${sortedDays.length}-ngay.txt`;
  } else {
    content += '# Kế hoạch Trong Ngày Của Bạn\n\n';
    fileName = 'ke-hoach-ngay.txt';
  }

  for (const day of sortedDays) {
    const itemsForDay = groupedByDay[day];
    if (sortedDays.length > 1) {
      content += `\n--- Ngày ${day} ---\n\n`;
    }

    itemsForDay.forEach((item: any, index) => {
      content += `## ${item.sequence}. ${item.name}\n`;
      content += `Thời gian: ${item.time || 'Linh hoạt'}\n`;
      if (item.duration) content += `Thời lượng: ${item.duration}\n`;
      content += `\n${item.description}\n\n`;

      if (index < itemsForDay.length - 1) {
        const nextItem = itemsForDay[index + 1];
        const connectingLine = lines.find((line: any) => {
          if ((line.day || 1) !== (item.day || 1)) return false;
           if (line.args && line.args.start && line.args.end) {
             const startMatch = Math.abs(Number(line.args.start.lat) - item.position.lat()) < 0.0001 && Math.abs(Number(line.args.start.lng) - item.position.lng()) < 0.0001;
             const endMatch = Math.abs(Number(line.args.end.lat) - nextItem.position.lat()) < 0.0001 && Math.abs(Number(line.args.end.lng) - nextItem.position.lng()) < 0.0001;
             if (startMatch && endMatch) return true;
          }
          const lineName = line.name.toLowerCase();
          const currentItemName = item.name.toLowerCase();
          const nextItemName = nextItem.name.toLowerCase();
          return lineName.includes(currentItemName) && lineName.includes(nextItemName);
        }) as any;

        if (connectingLine) {
          content += `### Di chuyển đến ${nextItem.name}\n`;
          content += `Phương thức: ${connectingLine.transport || 'Chưa xác định'}\n`;
          if (connectingLine.travelTime) {
            content += `Thời gian di chuyển: ${connectingLine.travelTime}\n`;
          }
          content += `\n`;
        }
      }
    });
  }

  const blob = new Blob([content], {type: 'text/plain;charset=utf-8'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
    