/**
 * ================================================================
 *  কৃষকবাজার — API.JS (Node.js Backend Connector)
 *  frontend/index.html এর সাথে কাজ করে
 *  Backend: http://localhost:8000
 * ================================================================
 */

// ─── Backend URL ── Railway deploy হলে এটা বদলান ────
const API_BASE = 'https://krishokbazar.onrender.com/api';

// const API_BASE = 'http://localhost:8000/api';

const SOCKET_BASE = API_BASE.replace('/api', '');
let chatSocket = null;
let chatSocketBound = false;
let selectedFarmer = null;
let pendingConversationId = null;
const productLookup = new Map();
const nearbyUserLookup = new Map();
const nearbyMaps = new Map();
let buyerOrdersRefreshTimer = null;

// ================================================================
//  1. AUTH HELPER — Token সংরক্ষণ
// ================================================================
const Auth = {
  save(token, user) {
    localStorage.setItem('kb_token', token);
    localStorage.setItem('kb_user',  JSON.stringify(user));
    connectChatSocket();
  },
  clear() {
    localStorage.removeItem('kb_token');
    localStorage.removeItem('kb_user');
    disconnectChatSocket();
  },
  token()    { return localStorage.getItem('kb_token'); },
  user()     { return JSON.parse(localStorage.getItem('kb_user') || 'null'); },
  loggedIn() { return !!this.token(); },
};

// ================================================================
//  2. HTTP HELPER — সব API request এখানে দিয়ে যায়
// ================================================================
async function http(path, opts = {}) {
  const headers = {};
  if (Auth.token()) headers['Authorization'] = `Bearer ${Auth.token()}`;

  // JSON body
  if (opts.json) {
    headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(opts.json);
    delete opts.json;
  }
  // FormData — browser নিজেই Content-Type দেবে
  opts.headers = { ...headers, ...opts.headers };

  try {
    const res = await fetch(`${API_BASE}${path}`, opts);

    if (res.status === 401) {
      Auth.clear();
      updateNavbar();
      showToast('⚠️ Session শেষ। আবার লগইন করুন।');
      goTo('auth');
      return null;
    }
    return res;
  } catch {
    return null; // Network error — handled by caller
  }
}

// ================================================================
//  3. AUTH API
// ================================================================
async function apiRegister(data) {
  const res = await http('/auth/register', { method: 'POST', json: data });
  if (!res) { showToast('❌ Server সংযোগ নেই।'); return null; }
  const body = await res.json();
  if (res.ok) {
    Auth.save(body.token, body.user);
    updateNavbar();
    showToast('🎉 অ্যাকাউন্ট তৈরি হয়েছে!');
  } else {
    showToast('❌ ' + (body.error || 'ত্রুটি হয়েছে।'));
  }
  return { ok: res.ok, data: body };
}

async function apiLogin(phone, password) {
  const res = await http('/auth/login', { method: 'POST', json: { phone, password } });
  if (!res) { showToast('❌ Server সংযোগ নেই।'); return null; }
  const body = await res.json();
  if (res.ok) {
    Auth.save(body.token, body.user);
    updateNavbar();
    showToast('✅ লগইন হয়েছে!');
  } else {
    showToast('❌ ' + (body.error || 'ফোন বা পাসওয়ার্ড ভুল।'));
  }
  return { ok: res.ok, data: body };
}

async function apiLogout() {
  Auth.clear();
  updateNavbar();
  showToast('👋 লগআউট হয়েছে।');
  goTo('home');
}

async function apiGetMe() {
  const res = await http('/auth/me');
  return res?.ok ? await res.json() : null;
}

async function apiUpdateMe(data) {
  const res = await http('/auth/me', { method: 'PATCH', json: data });
  const body = await res?.json();
  if (res?.ok && body?.user) {
    Auth.save(Auth.token(), { ...Auth.user(), ...body.user });
  }
  return res?.ok ? body.user : null;
}

async function apiFarmers(filters = {}) {
  const q = new URLSearchParams(filters).toString();
  const res = await http(`/auth/farmers${q ? '?' + q : ''}`);
  return res?.ok ? await res.json() : [];
}

async function apiFarmerById(id) {
  const res = await http(`/auth/farmers/${id}`);
  return res?.ok ? await res.json() : null;
}

async function apiNearbyUsers(filters = {}) {
  const q = new URLSearchParams(filters).toString();
  const res = await http(`/auth/nearby${q ? '?' + q : ''}`);
  const body = await res?.json();
  if (!res?.ok) return { ok: false, error: body?.error || 'Nearby users load failed', users: [] };
  return { ok: true, ...body };
}

// ================================================================
//  4. PRODUCTS API
// ================================================================
async function apiProducts(filters = {}) {
  const q = new URLSearchParams(filters).toString();
  const res = await http(`/products${q ? '?' + q : ''}`);
  return res?.ok ? await res.json() : [];
}

async function apiCreateProduct(formData) {
  const res = await http('/products', { method: 'POST', body: formData });
  const body = await res?.json();
  if (res?.ok) showToast('✅ পণ্য প্রকাশিত হয়েছে!');
  else showToast('❌ ' + (body?.error || 'পণ্য যোগ হয়নি।'));
  return res?.ok;
}

async function apiMyProducts() {
  const res = await http('/products/mine');
  return res?.ok ? await res.json() : [];
}

async function apiCategories() {
  const res = await http('/products/categories');
  return res?.ok ? await res.json() : [];
}

// ================================================================
//  5. ORDERS API
// ================================================================
async function apiPlaceOrder(productId, quantityKg, deliveryAddress, note = '') {
  const res = await http('/orders', {
    method: 'POST',
    json: { product_id: productId, quantity_kg: quantityKg, delivery_address: deliveryAddress, note },
  });
  const body = await res?.json();
  if (res?.ok) showToast('🎉 অর্ডার দেওয়া হয়েছে!');
  else showToast('❌ ' + (body?.error || 'অর্ডার দেওয়া যায়নি।'));
  return res?.ok;
}

async function apiMyOrders() {
  const res = await http('/orders');
  return res?.ok ? await res.json() : [];
}

async function apiIncomingOrders() {
  const res = await http('/orders/incoming');
  return res?.ok ? await res.json() : [];
}

async function apiUpdateOrderStatus(orderId, status) {
  const res = await http(`/orders/${orderId}/status`, { method: 'PATCH', json: { status } });
  if (res?.ok) showToast('✅ অর্ডার আপডেট হয়েছে!');
  return res?.ok;
}

async function apiBargain(orderId, price) {
  const res = await http(`/orders/${orderId}/bargain`, {
    method: 'POST', json: { proposed_price: price },
  });
  if (res?.ok) showToast(`💰 দরদাম পাঠানো হয়েছে: ৳${price}/কেজি`);
  return res?.ok;
}

// ================================================================
//  6. CHAT API
// ================================================================
async function apiConversations() {
  const res = await http('/chat');
  return res?.ok ? await res.json() : [];
}

async function apiStartConversation(userId) {
  const res = await http('/chat/start', { method: 'POST', json: { user_id: userId } });
  return res?.ok ? await res.json() : null;
}

async function apiMessages(convId) {
  const res = await http(`/chat/${convId}/messages`);
  return res?.ok ? await res.json() : [];
}

async function apiSendMessage(convId, text) {
  const res = await http(`/chat/${convId}/messages`, { method: 'POST', json: { text } });
  return res?.ok ? await res.json() : null;
}

function isChatPageOpen() {
  return document.getElementById('page-chat')?.classList.contains('active');
}

function isFarmerPageOpen() {
  return document.getElementById('page-farmer')?.classList.contains('active');
}

function isBuyerPageOpen() {
  return document.getElementById('page-buyer')?.classList.contains('active');
}

function stopBuyerOrdersAutoRefresh() {
  if (buyerOrdersRefreshTimer) {
    clearInterval(buyerOrdersRefreshTimer);
    buyerOrdersRefreshTimer = null;
  }
}

function startBuyerOrdersAutoRefresh() {
  stopBuyerOrdersAutoRefresh();
  buyerOrdersRefreshTimer = setInterval(() => {
    if (isBuyerPageOpen() && Auth.loggedIn()) {
      loadBuyerDashboard();
    }
  }, 8000);
}

function connectChatSocket() {
  if (!Auth.loggedIn() || typeof io !== 'function') return null;
  if (chatSocket?.connected) return chatSocket;

  chatSocket = io(SOCKET_BASE, {
    transports: ['websocket', 'polling'],
    auth: { token: Auth.token() },
    withCredentials: true,
  });

  if (!chatSocketBound) {
    chatSocket.on('connect', () => {
      if (activeConvId) joinConversationRoom(activeConvId);
    });

    chatSocket.on('connect_error', () => {
      console.warn('Socket connection failed');
    });

    chatSocket.on('chat:new_message', (message) => {
      if (!message?.conversation_id) return;
      if (Number(message.conversation_id) === Number(activeConvId)) {
        appendChatMessage(message);
      } else if (isChatPageOpen()) {
        loadChatPage();
      }
    });

    chatSocket.on('chat:conversation_updated', () => {
      if (isChatPageOpen()) loadChatPage();
    });

    chatSocket.on('order:created', () => {
      if (isFarmerPageOpen()) loadFarmerDashboard();
      if (isBuyerPageOpen()) loadBuyerDashboard();
    });

    chatSocket.on('order:updated', () => {
      if (isFarmerPageOpen()) loadFarmerDashboard();
      if (isBuyerPageOpen()) loadBuyerDashboard();
    });

    chatSocketBound = true;
  }

  return chatSocket;
}

function disconnectChatSocket() {
  if (chatSocket) {
    chatSocket.disconnect();
    chatSocket = null;
  }
}

function joinConversationRoom(conversationId) {
  if (!conversationId) return;
  const socket = connectChatSocket();
  if (!socket || !socket.connected) return;
  socket.emit('chat:join_conversation', { conversation_id: conversationId });
}

function renderMessageBubble(m, me) {
  const mine = m.sender_id === me?.id;
  return `<div class="msg-bubble ${mine ? 'sent' : 'recv'}">
    ${!mine ? `<div class="msg-sender">${m.first_name || ''} ${m.last_name || ''}</div>` : ''}
    ${m.text}
    <div class="msg-time">${fmtTime(m.created_at)}</div>
  </div>`;
}

function appendChatMessage(message) {
  const me = Auth.user();
  const box = document.getElementById('chat-msgs');
  if (!box) return;
  box.insertAdjacentHTML('beforeend', renderMessageBubble(message, me));
  box.scrollTop = box.scrollHeight;
}

// ================================================================
//  7. DATA HELPERS
// ================================================================
function apiProductToCard(p) {
  const imgBase = `${API_BASE.replace('/api', '')}/uploads/`;
  return {
    id:       p.id,
    name:     p.name,
    emoji:    catEmoji(p.category_name),
    cat:      p.category_name || 'সাধারণ',
    farmer:   `${p.farmer_first || ''} ${p.farmer_last || ''}`.trim(),
    loc:      p.farmer_district || p.district || '—',
    qty:      `${p.quantity_kg} কেজি`,
    price:    parseFloat(p.price_per_kg),
    date:     p.harvest_date ? new Date(p.harvest_date).toLocaleDateString('bn-BD') : '—',
    bg:       catBg(p.category_name),
    organic:  p.is_organic,
    verified: p.farmer_verified,
    img:      p.image ? `${imgBase}${p.image}` : catFallbackImg(p.category_name),
    farmerId: p.farmer_id,
  };
}

function cacheProducts(list = []) {
  list.forEach((item) => {
    if (item?.id) productLookup.set(Number(item.id), item);
  });
}

function toCardProduct(p) {
  if (!p) return null;
  return {
    id: p.id,
    name: p.name,
    emoji: catEmoji(p.category_name),
    cat: p.category_name || 'সাধারণ',
    farmer: `${p.farmer_first || ''} ${p.farmer_last || ''}`.trim(),
    loc: p.farmer_district || p.district || '—',
    qty: `${p.quantity_kg} কেজি`,
    price: parseFloat(p.price_per_kg || 0),
    date: p.harvest_date ? new Date(p.harvest_date).toLocaleDateString('bn-BD') : '—',
    bg: catBg(p.category_name),
    organic: p.is_organic,
    verified: p.farmer_verified,
    img: p.image ? `${API_BASE.replace('/api', '')}/uploads/${p.image}` : catFallbackImg(p.category_name),
    farmerId: p.farmer_id,
  };
}

function formatFarmerName(f) {
  return `${f?.first_name || ''} ${f?.last_name || ''}`.trim() || 'নাম নেই';
}

function formatUserName(user) {
  return `${user?.first_name || ''} ${user?.last_name || ''}`.trim() || 'নাম নেই';
}

function userRoleLabel(role) {
  return role === 'farmer' ? 'কৃষক' : 'ক্রেতা';
}

function renderBuyerFarmers(farmers = []) {
  const listEl = document.getElementById('buyer-farmers-list');
  const countEl = document.getElementById('buyer-farmers-count');
  if (!listEl) return;
  if (countEl) countEl.textContent = `${farmers.length} জন`;

  if (!farmers.length) {
    listEl.innerHTML = `<div style="text-align:center;padding:1.2rem;color:var(--gray-400);background:white;border:1px solid var(--gray-200);border-radius:var(--radius);">কোনো কৃষক নিবন্ধিত নেই।</div>`;
    return;
  }

  listEl.innerHTML = farmers.map((f) => `
    <div class="farmer-card" onclick="openNearbyProfile(${f.id}, 'farmer')">
      <div class="f-av">${f.is_verified ? '🧑‍🌾' : '👨‍🌾'}</div>
      <div class="f-info">
        <div class="f-name">
          ${formatFarmerName(f)}
          ${f.is_verified ? '<span class="badge badge-verified" style="font-size:.6rem;">✅</span>' : ''}
        </div>
        <div class="f-loc">📍 ${f.district || 'জেলা নেই'}${f.distance_km ? ` · ${f.distance_km} কিমি` : ''}</div>
        <div class="f-prods">⭐ ${Number(f.avg_rating || 0).toFixed(1)} রেটিং · 📦 ${f.total_orders || 0} অর্ডার</div>
      </div>
      <button class="btn btn-primary btn-sm" type="button">দেখুন</button>
    </div>
  `).join('');
}

function renderFarmerProfile(farmer) {
  renderUserProfile(farmer);
}

function renderUserProfile(user) {
  if (!user) return;
  selectedFarmer = user;

  const isSelf = Auth.user()?.id === user.id;
  const name = formatUserName(user);

  const nameEl = document.getElementById('profile-name');
  const districtEl = document.getElementById('profile-district');
  const expEl = document.getElementById('profile-experience');
  const landEl = document.getElementById('profile-land');
  const totalOrdersEl = document.getElementById('profile-total-orders');
  const ratingEl = document.getElementById('profile-rating');
  const phoneEl = document.getElementById('profile-phone');
  const bioEl = document.getElementById('profile-bio');
  const avatarEl = document.getElementById('profile-avatar');
  const badgesEl = document.getElementById('profile-badges');
  const messageBtn = document.querySelector('#page-profile .btn.btn-primary.btn-sm');
  const orderBtn = document.querySelector('#page-profile .btn.btn-accent.btn-sm');

  if (nameEl) nameEl.textContent = name;
  if (districtEl) districtEl.textContent = user.district || 'জেলা নেই';
  if (expEl) expEl.textContent = user.role === 'farmer' ? `${user.experience_yrs || 0} বছর` : 'প্রযোজ্য নয়';
  if (landEl) landEl.textContent = user.role === 'farmer' ? `${user.land_size || 0} বিঘা` : 'প্রযোজ্য নয়';
  if (totalOrdersEl) totalOrdersEl.textContent = `${user.total_orders || 0}টি`;
  if (ratingEl) ratingEl.textContent = user.role === 'farmer' ? `${Number(user.avg_rating || 0).toFixed(1)} / ৫.০` : 'প্রযোজ্য নয়';
  if (phoneEl) phoneEl.textContent = user.phone || 'প্রাইভেট';
  if (bioEl) bioEl.textContent = user.bio || `${userRoleLabel(user.role)} প্রোফাইল। বার্তা পাঠিয়ে সরাসরি যোগাযোগ করুন।`;
  if (avatarEl) avatarEl.textContent = user.role === 'farmer' ? (user.is_verified ? '🧑‍🌾' : '👨‍🌾') : '🏪';

  if (badgesEl) {
    badgesEl.innerHTML = `
      ${user.is_verified ? `<span class="badge badge-verified">✅ যাচাইকৃত ${userRoleLabel(user.role)}</span>` : ''}
      <span class="badge badge-green">${userRoleLabel(user.role)}</span>
      ${user.distance_km ? `<span class="badge badge-blue">📍 ${user.distance_km} কিমি দূরে</span>` : ''}
      ${user.role === 'farmer' ? `<span class="badge badge-amber">📦 ${user.total_orders || 0} অর্ডার</span>` : ''}
    `;
  }

  if (messageBtn) {
    messageBtn.style.display = !isSelf ? '' : 'none';
  }
  if (orderBtn) {
    orderBtn.style.display = user.role === 'farmer' ? '' : 'none';
  }
  renderProfileMap(user);
}

async function openFarmerProfile(farmerId) {
  const farmer = await apiFarmerById(farmerId);
  if (!farmer) {
    showToast('❌ কৃষকের তথ্য পাওয়া যায়নি।');
    return;
  }
  renderFarmerProfile(farmer);
  goTo('profile');
}

async function openNearbyProfile(userId, role = 'farmer') {
  let user = nearbyUserLookup.get(Number(userId));
  if (!user && role === 'farmer') user = await apiFarmerById(userId);
  if (!user) {
    showToast('❌ ব্যবহারকারীর তথ্য পাওয়া যায়নি।');
    return;
  }
  renderUserProfile(user);
  goTo('profile');
}

async function startChatWithUser(userId) {
  const me = Auth.user();
  if (!me) {
    showToast('⚠️ বার্তা পাঠাতে লগইন করুন।');
    goTo('auth');
    return;
  }
  if (me.id === Number(userId)) {
    showToast('⚠️ নিজের সাথে chat করা যাবে না।');
    return;
  }

  const conv = await apiStartConversation(userId);
  if (!conv?.conversation_id) {
    showToast('❌ Chat শুরু করা যায়নি।');
    return;
  }

  pendingConversationId = Number(conv.conversation_id);
  goTo('chat');
  await loadChatPage();
}

async function startChatWithFarmer(farmerId) {
  await startChatWithUser(farmerId);
}

async function startProfileChat() {
  if (!selectedFarmer?.id) {
    showToast('⚠️ আগে একজন ব্যবহারকারী নির্বাচন করুন।');
    return;
  }
  await startChatWithUser(selectedFarmer.id);
}

function catEmoji(cat) {
  return { 'শাকসবজি':'🥬', 'ফল':'🍎', 'শস্য':'🌾', 'মসলা':'🌶️' }[cat] || '🌿';
}
function catBg(cat) {
  return { 'শাকসবজি':'#f0fdf4', 'ফল':'#fff7ed', 'শস্য':'#fefce8', 'মসলা':'#fff1f2' }[cat] || '#f0fdf4';
}
function catFallbackImg(cat) {
  return {
    'শাকসবজি': 'https://images.unsplash.com/photo-1576045057995-568f588f82fb?w=480&h=300&fit=crop',
    'ফল':      'https://images.unsplash.com/photo-1601493700631-2b16ec4b4716?w=480&h=300&fit=crop',
    'শস্য':    'https://images.unsplash.com/photo-1536054215-5423c9f90f97?w=480&h=300&fit=crop',
    'মসলা':    'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=480&h=300&fit=crop',
  }[cat] || 'https://images.unsplash.com/photo-1560493676-04071c5f467b?w=480&h=300&fit=crop';
}
function fmtTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

function fmtDateBn(date = new Date()) {
  return date.toLocaleDateString('bn-BD', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

function weatherInfo(code) {
  const map = {
    0: ['☀️', 'পরিষ্কার আকাশ'],
    1: ['🌤️', 'প্রধানত পরিষ্কার'],
    2: ['⛅', 'আংশিক মেঘলা'],
    3: ['☁️', 'মেঘলা'],
    45: ['🌫️', 'কুয়াশা'],
    48: ['🌫️', 'ঘন কুয়াশা'],
    51: ['🌦️', 'হালকা গুঁড়ি বৃষ্টি'],
    53: ['🌦️', 'গুঁড়ি বৃষ্টি'],
    55: ['🌧️', 'ঘন গুঁড়ি বৃষ্টি'],
    61: ['🌧️', 'হালকা বৃষ্টি'],
    63: ['🌧️', 'বৃষ্টি'],
    65: ['🌧️', 'ভারী বৃষ্টি'],
    80: ['🌦️', 'হালকা ঝড়ো বৃষ্টি'],
    81: ['🌧️', 'ঝড়ো বৃষ্টি'],
    82: ['⛈️', 'ভারী ঝড়ো বৃষ্টি'],
    95: ['⛈️', 'বজ্রঝড়'],
    96: ['⛈️', 'শিলাসহ বজ্রঝড়'],
    99: ['⛈️', 'তীব্র বজ্রঝড়'],
  };
  return map[Number(code)] || ['🌤️', 'আবহাওয়া আপডেট'];
}

function farmingWeatherNote(code, rainChance = 0) {
  const c = Number(code);
  if ([61, 63, 65, 80, 81, 82, 95, 96, 99].includes(c) || rainChance >= 60) {
    return 'বৃষ্টি হতে পারে, ফসল ও পরিবহনে সতর্ক থাকুন';
  }
  if ([45, 48].includes(c)) return 'কুয়াশা আছে, সকালের কাজে সতর্ক থাকুন';
  if ([0, 1, 2].includes(c)) return 'চাষের জন্য ভালো আবহাওয়া';
  return 'আবহাওয়া মাঝারি, মাঠের কাজ পরিকল্পনা করে করুন';
}

async function geocodeDistrict(district) {
  if (!district) return null;
  try {
    const q = encodeURIComponent(`${district}, Bangladesh`);
    const res = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${q}&count=1&language=en&format=json`);
    const body = await res.json();
    const place = body?.results?.[0];
    if (!place) return null;
    return {
      latitude: place.latitude,
      longitude: place.longitude,
      label: place.name || district,
    };
  } catch {
    return null;
  }
}

async function resolveWeatherLocation(user) {
  if (hasSavedLocation(user)) {
    return {
      latitude: Number(user.latitude),
      longitude: Number(user.longitude),
      label: user.district || 'আপনার লোকেশন',
    };
  }
  return geocodeDistrict(user?.district);
}

function renderFarmerWeatherLoading(user) {
  const locEl = document.querySelector('#page-farmer .ww-loc');
  const descEl = document.querySelector('#page-farmer .ww-desc');
  if (locEl) locEl.textContent = `📍 ${user?.district || 'লোকেশন'} — আবহাওয়া লোড হচ্ছে...`;
  if (descEl) descEl.textContent = 'লাইভ আবহাওয়া তথ্য আনা হচ্ছে...';
}

async function loadFarmerWeather(user) {
  renderFarmerWeatherLoading(user);
  const loc = await resolveWeatherLocation(user);
  const locEl = document.querySelector('#page-farmer .ww-loc');
  const iconEl = document.querySelector('#page-farmer .ww-icon');
  const tempEl = document.querySelector('#page-farmer .ww-temp');
  const descEl = document.querySelector('#page-farmer .ww-desc');
  const detailVals = document.querySelectorAll('#page-farmer .ww-detail .wd-val');
  const forecastEl = document.querySelector('#page-farmer .ww-forecast');

  if (!loc) {
    if (locEl) locEl.textContent = '📍 লোকেশন নেই — কৃষি আবহাওয়া পূর্বাভাস';
    if (descEl) descEl.textContent = 'সঠিক আবহাওয়ার জন্য নিজের লোকেশন সেভ করুন।';
    return;
  }

  try {
    const params = new URLSearchParams({
      latitude: loc.latitude,
      longitude: loc.longitude,
      current: 'temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m',
      daily: 'weather_code,temperature_2m_max,precipitation_probability_max',
      timezone: 'auto',
      forecast_days: '7',
    });
    const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params.toString()}`);
    const data = await res.json();
    const current = data.current || {};
    const rainChance = data.daily?.precipitation_probability_max?.[0] ?? 0;
    const [icon, desc] = weatherInfo(current.weather_code);

    if (locEl) locEl.textContent = `📍 ${loc.label} — লাইভ কৃষি আবহাওয়া`;
    if (iconEl) iconEl.textContent = icon;
    if (tempEl) tempEl.textContent = `${Math.round(current.temperature_2m || 0).toLocaleString('bn-BD')}°C`;
    if (descEl) descEl.textContent = `${desc} · ${farmingWeatherNote(current.weather_code, rainChance)}`;
    if (detailVals[0]) detailVals[0].textContent = `${Math.round(current.relative_humidity_2m || 0).toLocaleString('bn-BD')}%`;
    if (detailVals[1]) detailVals[1].textContent = `${Math.round(current.wind_speed_10m || 0).toLocaleString('bn-BD')}km/h`;
    if (detailVals[2]) detailVals[2].textContent = `${Math.round(rainChance).toLocaleString('bn-BD')}%`;

    if (forecastEl && data.daily?.time?.length) {
      forecastEl.innerHTML = data.daily.time.map((day, idx) => {
        const d = new Date(day);
        const label = idx === 0 ? 'আজ' : d.toLocaleDateString('bn-BD', { weekday: 'short' });
        const [dayIcon] = weatherInfo(data.daily.weather_code?.[idx]);
        const temp = Math.round(data.daily.temperature_2m_max?.[idx] || 0).toLocaleString('bn-BD');
        return `<div class="wf-day"><div class="d-name">${label}</div><div class="d-icon">${dayIcon}</div><div class="d-temp">${temp}°</div></div>`;
      }).join('');
    }
  } catch {
    if (locEl) locEl.textContent = `📍 ${loc.label} — আবহাওয়া আপডেট হয়নি`;
    if (descEl) descEl.textContent = 'লাইভ আবহাওয়া আনতে সমস্যা হয়েছে। পরে আবার চেষ্টা করুন।';
  }
}

function hasSavedLocation(user = Auth.user()) {
  return Number.isFinite(Number(user?.latitude)) && Number.isFinite(Number(user?.longitude));
}

function getOrCreateMap(mapId, center = [23.8103, 90.4125], zoom = 10) {
  const el = document.getElementById(mapId);
  if (!el || typeof L === 'undefined') return null;

  let entry = nearbyMaps.get(mapId);
  if (!entry) {
    const map = L.map(mapId, { scrollWheelZoom: false }).setView(center, zoom);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
    }).addTo(map);
    const layer = L.layerGroup().addTo(map);
    entry = { map, layer };
    nearbyMaps.set(mapId, entry);
  }

  entry.layer.clearLayers();
  setTimeout(() => entry.map.invalidateSize(), 80);
  return entry;
}

function popupHtml(user) {
  const distance = user.distance_km ? `<br><strong>দূরত্ব:</strong> ${user.distance_km} কিমি` : '';
  return `
    <strong>${formatUserName(user)}</strong><br>
    ${userRoleLabel(user.role)} · ${user.district || 'জেলা নেই'}${distance}<br>
    <button class="btn btn-primary btn-sm" onclick="openNearbyProfile(${user.id}, '${user.role}')">প্রোফাইল দেখুন</button>
  `;
}

function renderNearbyMap(mapId, payload, users = []) {
  const center = payload?.center
    ? [Number(payload.center.latitude), Number(payload.center.longitude)]
    : [23.8103, 90.4125];
  const entry = getOrCreateMap(mapId, center, users.length ? 11 : 8);
  if (!entry) return;

  const { map, layer } = entry;
  const bounds = [];
  L.marker(center).addTo(layer).bindPopup('<strong>আপনি এখানে</strong>');
  bounds.push(center);

  users.forEach((user) => {
    const lat = Number(user.display_lat);
    const lng = Number(user.display_lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    nearbyUserLookup.set(Number(user.id), user);
    const marker = L.marker([lat, lng]).addTo(layer).bindPopup(popupHtml(user));
    marker.on('click', () => marker.openPopup());
    bounds.push([lat, lng]);
  });

  if (bounds.length > 1) map.fitBounds(bounds, { padding: [24, 24], maxZoom: 12 });
  else map.setView(center, 11);
}

function renderProfileMap(user) {
  const lat = Number(user?.display_lat ?? user?.latitude);
  const lng = Number(user?.display_lng ?? user?.longitude);
  const entry = getOrCreateMap('profile-map', Number.isFinite(lat) && Number.isFinite(lng) ? [lat, lng] : [23.8103, 90.4125], 11);
  if (!entry) return;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    entry.map.setView([23.8103, 90.4125], 7);
    return;
  }
  L.marker([lat, lng]).addTo(entry.layer).bindPopup(`<strong>${formatUserName(user)}</strong><br>${user.district || 'লোকেশন'}`).openPopup();
  entry.map.setView([lat, lng], 11);
}

async function loadNearbyForDashboard(context) {
  const targetRole = context === 'buyer' ? 'farmer' : 'buyer';
  const mapId = context === 'buyer' ? 'buyer-nearby-map' : 'farmer-nearby-map';
  const statusEl = document.getElementById(context === 'buyer' ? 'buyer-map-status' : 'farmer-map-status');
  const countEl = document.getElementById(context === 'buyer' ? 'buyer-farmers-count' : 'farmer-nearby-count');
  const noteEl = document.getElementById('buyer-nearby-note');
  const user = Auth.user();

  if (!hasSavedLocation(user)) {
    if (statusEl) statusEl.textContent = 'নিজের লোকেশন সেভ করলে কাছের ব্যবহারকারী দেখা যাবে।';
    if (noteEl && context === 'buyer') noteEl.textContent = 'উপরের বাটন থেকে লোকেশন সেভ করুন, তারপর কাছের কৃষক দেখানো হবে।';
    renderNearbyMap(mapId, null, []);
    return [];
  }

  if (statusEl) statusEl.textContent = 'কাছাকাছি ব্যবহারকারী খোঁজা হচ্ছে...';
  const payload = await apiNearbyUsers({ target_role: targetRole, radius_km: 50, limit: 20 });
  if (!payload.ok) {
    if (statusEl) statusEl.textContent = payload.error || 'কাছের ব্যবহারকারী লোড হয়নি।';
    renderNearbyMap(mapId, { center: { latitude: user.latitude, longitude: user.longitude } }, []);
    return [];
  }

  const users = payload.users || [];
  users.forEach((u) => nearbyUserLookup.set(Number(u.id), u));
  renderNearbyMap(mapId, payload, users);
  if (statusEl) statusEl.textContent = `${users.length} জন ${targetRole === 'farmer' ? 'কৃষক' : 'ক্রেতা'} ৫০ কিমির মধ্যে পাওয়া গেছে।`;
  if (countEl) countEl.textContent = context === 'buyer' ? `${users.length} জন` : `${users.length} জন কাছে আছেন`;
  if (noteEl && context === 'buyer') noteEl.textContent = users.length ? 'দূরত্ব অনুযায়ী কাছের কৃষক আগে দেখানো হয়েছে।' : 'আপনার কাছাকাছি কোনো কৃষক এখনো লোকেশন সেভ করেননি।';
  return users;
}

async function saveMyLocation(context = Auth.user()?.role || 'buyer') {
  if (!Auth.loggedIn()) {
    showToast('⚠️ লোকেশন সেভ করতে লগইন করুন।');
    goTo('auth');
    return;
  }
  if (!navigator.geolocation) {
    showToast('❌ আপনার browser location support করে না।');
    return;
  }

  showToast('📍 লোকেশন নেওয়া হচ্ছে...');
  navigator.geolocation.getCurrentPosition(async (pos) => {
    const updated = await apiUpdateMe({
      latitude: pos.coords.latitude,
      longitude: pos.coords.longitude,
    });
    if (!updated) {
      showToast('❌ লোকেশন সেভ করা যায়নি।');
      return;
    }
    showToast('✅ লোকেশন সেভ হয়েছে।');
    await loadNearbyForDashboard(context);
  }, () => {
    showToast('❌ লোকেশন permission দিতে হবে।');
  }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
}

// ================================================================
//  8. PAGE LOADERS
// ================================================================
async function loadHomeProducts() {
  const list = await apiProducts({ status: 'available' });
  if (list.length) {
    cacheProducts(list);
    renderProds(list.slice(0, 4).map(apiProductToCard), 'home-prod-grid');
  }
  else if (typeof products !== 'undefined') renderProds(products.slice(0, 4), 'home-prod-grid');
}

async function loadAllProducts(filters = {}) {
  const grid = document.getElementById('products-grid');
  if (grid) grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:3rem;color:var(--gray-400);"><div style="font-size:2rem;margin-bottom:.5rem;">⏳</div>লোড হচ্ছে...</div>`;
  const list = await apiProducts({ status: 'available', ...filters });
  if (list.length) {
    cacheProducts(list);
    renderProds(list.map(apiProductToCard), 'products-grid');
  }
  else if (typeof products !== 'undefined') renderProds(products, 'products-grid');
}

async function loadFarmerDashboard() {
  let user = Auth.user();
  if (!user) return;
  const freshUser = await apiGetMe();
  if (freshUser) {
    Auth.save(Auth.token(), { ...user, ...freshUser });
    user = Auth.user();
  }
  const nameEl = document.querySelector('#page-farmer .sb-name');
  const roleEl = document.querySelector('#page-farmer .sb-role');
  const headTitle = document.querySelector('#page-farmer .d-head h1');
  const headSub = document.querySelector('#page-farmer .d-head p');
  const fullName = formatUserName(user);
  if (nameEl) nameEl.textContent = fullName;
  if (roleEl) roleEl.textContent = `কৃষক · ${user.district || ''}`;
  if (headTitle) headTitle.textContent = `স্বাগতম, ${user.first_name || fullName} ভাই! 👋`;
  if (headSub) headSub.textContent = `${fmtDateBn()} · ${user.district || 'লোকেশন সেট করা নেই'}`;
  loadFarmerWeather(user);

  const orders  = await apiIncomingOrders();
  const myProds = await apiMyProducts();
  renderFarmerProducts(myProds);
  renderFarmerOrders(orders);
  await loadNearbyForDashboard('farmer');

  // KPI আপডেট
  const kpis = document.querySelectorAll('#page-farmer .kpi-val');
  if (kpis[0]) kpis[0].textContent = myProds.length;
  if (kpis[1]) kpis[1].textContent = orders.length;
}

async function loadBuyerDashboard() {
  const user = Auth.user();
  if (!user) return;
  const h1 = document.querySelector('#page-buyer .buyer-hero h1');
  if (h1) h1.textContent = `স্বাগতম, ${user.first_name}! 🏪`;
  const orders = await apiMyOrders();
  renderBuyerOrders(orders);
  renderBuyerMonthlySummary(orders);
  const nearbyFarmers = await loadNearbyForDashboard('buyer');
  const farmers = nearbyFarmers.length ? nearbyFarmers : await apiFarmers();
  farmers.forEach((f) => nearbyUserLookup.set(Number(f.id), f));
  renderBuyerFarmers(farmers);
  startBuyerOrdersAutoRefresh();
}

async function loadChatPage() {
  if (!Auth.loggedIn()) return;
  connectChatSocket();
  const convs = await apiConversations();
  const list  = document.querySelector('.chat-contacts');
  if (!list) return;
  if (!convs.length) {
    list.innerHTML = `<div style="padding:2rem;text-align:center;color:var(--gray-400);font-size:.82rem;">কোনো বার্তা নেই।<br>পণ্যের পেজ থেকে কৃষকের সাথে যোগাযোগ করুন।</div>`;
    const box = document.getElementById('chat-msgs');
    if (box) box.innerHTML = `<div style="padding:1.2rem;color:var(--gray-400);">কথোপকথন শুরু করতে একজন কৃষকের প্রোফাইল থেকে "💬 বার্তা পাঠান" চাপুন।</div>`;
    return;
  }
  list.innerHTML = convs.map(c => `
    <div class="chat-contact" data-conversation-id="${c.id}" onclick="openConv(${c.id},'${(c.other_user?.first_name||'ব্যবহারকারী')} ${c.other_user?.last_name||''}', event)">
      <div class="cc-av">${c.other_user?.role === 'farmer' ? '🧑‍🌾' : '🏪'}</div>
      <div class="cc-info">
        <div class="cc-name">${c.other_user?.first_name || ''} ${c.other_user?.last_name || ''}</div>
        <div class="cc-last">${c.last_text || 'বার্তা শুরু করুন'}</div>
      </div>
      <div class="cc-meta">
        <div class="cc-time">${fmtTime(c.last_time)}</div>
        ${c.unread > 0 ? `<div class="cc-unread">${c.unread}</div>` : ''}
      </div>
    </div>`).join('');

  if (pendingConversationId) {
    const targetConv = convs.find((c) => Number(c.id) === Number(pendingConversationId));
    if (targetConv) {
      const el = list.querySelector(`[data-conversation-id="${pendingConversationId}"]`);
      await openConv(
        targetConv.id,
        `${targetConv.other_user?.first_name || 'ব্যবহারকারী'} ${targetConv.other_user?.last_name || ''}`,
        { currentTarget: el }
      );
      pendingConversationId = null;
      return;
    }
  }
}

let activeConvId = null;
async function openConv(convId, name, evt) {
  activeConvId = convId;
  document.querySelectorAll('.chat-contact').forEach(c => c.classList.remove('active'));
  evt?.currentTarget?.classList.add('active');
  const nameEl = document.getElementById('chat-partner-name');
  if (nameEl) nameEl.textContent = name.trim();

  const msgs = await apiMessages(convId);
  const me   = Auth.user();
  const box  = document.getElementById('chat-msgs');
  if (!box) return;
  box.innerHTML = msgs.map((m) => renderMessageBubble(m, me)).join('');
  box.scrollTop = box.scrollHeight;
  joinConversationRoom(convId);
}

// ================================================================
//  9. RENDER HELPERS
// ================================================================
function renderFarmerOrders(orders) {
  const tbody = document.querySelector('#farmer-orders-section .otable tbody');
  if (!tbody) return;
  const countEl = document.getElementById('farmer-orders-count');
  if (countEl) countEl.textContent = `${orders.length}টি`;
  const badge = {
    pending:   '<span class="badge badge-amber">অপেক্ষমান</span>',
    accepted:  '<span class="badge badge-green">গৃহীত</span>',
    rejected:  '<span class="badge badge-red">বাতিল</span>',
    delivered: '<span class="badge badge-blue">ডেলিভারি</span>',
  };
  tbody.innerHTML = !orders.length
    ? `<tr><td colspan="6" style="text-align:center;padding:2rem;color:var(--gray-400);">কোনো অর্ডার নেই।</td></tr>`
    : orders.map(o => `
      <tr>
        <td>${o.product_name}</td>
        <td>${o.buyer_first} ${o.buyer_last || ''}</td>
        <td>${o.quantity_kg} কেজি</td>
        <td>৳${parseFloat(o.total_price).toLocaleString()}</td>
        <td>${badge[o.status] || o.status}</td>
        <td style="display:flex;gap:.3rem;flex-wrap:wrap;">
          ${o.status === 'pending' ? `
            <button class="btn btn-green btn-sm" onclick="doAccept(${o.id})">✅ গ্রহণ</button>
            <button class="btn btn-danger btn-sm" onclick="doReject(${o.id})">❌ বাতিল</button>
          ` : o.status === 'accepted' ? `
            <button class="btn btn-primary btn-sm" onclick="doDelivered(${o.id})">🚚 ডেলিভার্ড</button>
            <button class="btn btn-outline btn-sm" onclick="goTo('chat')">💬 বার্তা</button>
          ` : `<button class="btn btn-outline btn-sm" onclick="goTo('chat')">💬 বার্তা</button>`}
        </td>
      </tr>`).join('');
}

function renderFarmerProducts(products) {
  const tbody = document.getElementById('farmer-products-tbody');
  if (!tbody) return;
  const countEl = document.getElementById('farmer-products-count');
  if (countEl) countEl.textContent = `${products.length}টি`;

  const badge = {
    available: '<span class="badge badge-green">প্রকাশিত</span>',
    sold_out: '<span class="badge badge-red">স্টক শেষ</span>',
    inactive: '<span class="badge badge-amber">নিষ্ক্রিয়</span>',
  };

  tbody.innerHTML = !products.length
    ? `<tr><td colspan="5" style="text-align:center;padding:2rem;color:var(--gray-400);">এখনো কোনো পণ্য আপলোড করা হয়নি।</td></tr>`
    : products.map((p) => `
      <tr>
        <td>${p.name}</td>
        <td>${p.quantity_kg} কেজি</td>
        <td>৳${parseFloat(p.price_per_kg).toLocaleString()}</td>
        <td>${badge[p.status] || p.status}</td>
        <td>${new Date(p.created_at).toLocaleDateString('bn-BD')}</td>
      </tr>
    `).join('');
}

function renderBuyerOrders(orders) {
  const box = document.querySelector('#page-buyer .orders-list');
  if (!box) return;
  const countEl = document.getElementById('buyer-orders-count');
  if (countEl) countEl.textContent = `${orders.length}টি`;
  const cls = { pending:'badge-amber', accepted:'badge-green', rejected:'badge-red', delivered:'badge-blue' };
  const bn  = { pending:'প্রক্রিয়াধীন', accepted:'গৃহীত', rejected:'বাতিল', delivered:'ডেলিভারি হয়েছে' };
  box.innerHTML = !orders.length
    ? `<div style="text-align:center;padding:2rem;color:var(--gray-400);">কোনো অর্ডার নেই।<br><button class="btn btn-primary btn-sm" style="margin-top:.75rem;" onclick="goTo('products')">পণ্য দেখুন</button></div>`
    : orders.map(o => `
      <div class="order-item">
        <div class="oi-emoji">${catEmoji(o.category_name)}</div>
        <div class="oi-info">
          <div class="oi-name">${o.product_name}</div>
          <div class="oi-detail">${o.quantity_kg} কেজি · ${o.farmer_first} ${o.farmer_last || ''} · ${fmtTime(o.updated_at || o.created_at)}</div>
          <div style="margin-top:4px;"><span class="badge ${cls[o.status]}">${bn[o.status]}</span></div>
        </div>
        <div class="oi-price">৳${parseFloat(o.total_price).toLocaleString()}</div>
      </div>`).join('');
}

function renderBuyerMonthlySummary(orders) {
  const spendEl = document.getElementById('buyer-monthly-spend');
  const rateEl = document.getElementById('buyer-monthly-saving-rate');
  const noteEl = document.getElementById('buyer-monthly-saving-note');
  if (!spendEl || !rateEl || !noteEl) return;

  const now = new Date();
  const monthOrders = orders.filter((o) => {
    const d = new Date(o.created_at);
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
  });

  const totalSpend = monthOrders.reduce((sum, o) => sum + parseFloat(o.total_price || 0), 0);
  const totalBase = monthOrders.reduce(
    (sum, o) => sum + (parseFloat(o.price_per_kg || 0) * parseFloat(o.quantity_kg || 0)),
    0
  );
  const totalSavings = Math.max(totalBase - totalSpend, 0);
  const savingRate = totalBase > 0 ? (totalSavings / totalBase) * 100 : 0;

  spendEl.textContent = `৳${totalSpend.toLocaleString('bn-BD')}`;
  rateEl.textContent = `${savingRate.toFixed(1)}%`;
  noteEl.textContent = `সাশ্রয় হয়েছে (৳${totalSavings.toLocaleString('bn-BD')})`;
}

// ================================================================
//  10. OVERRIDE HTML FORM FUNCTIONS
// ================================================================

// লগইন
async function handleLogin() {
  const phone = document.querySelector('#form-login input[type="text"]')?.value?.trim();
  const pass  = document.querySelector('#form-login input[type="password"]')?.value;
  if (!phone || !pass) { showToast('⚠️ ফোন ও পাসওয়ার্ড দিন।'); return; }
  const r = await apiLogin(phone, pass);
  if (r?.ok) setTimeout(() => goTo(r.data.user.role === 'farmer' ? 'farmer' : 'buyer'), 800);
}

// রেজিস্ট্রেশন
async function handleRegister() {
  const isFarmer = document.getElementById('r-farmer')?.classList.contains('sel');
  const name  = document.querySelector('#form-register input[placeholder="আপনার নাম"]')?.value?.trim();
  const phone = document.querySelector('#form-register input[type="tel"]')?.value?.trim();
  const dist  = document.querySelector('#form-register .form-select')?.value;
  const pass  = document.querySelector('#form-register input[type="password"]')?.value;
  if (!name || !phone || !pass) { showToast('⚠️ সব তথ্য পূরণ করুন।'); return; }
  if (pass.length < 6) { showToast('⚠️ পাসওয়ার্ড কমপক্ষে ৬ অক্ষর দিন।'); return; }
  const r = await apiRegister({
    first_name: name, phone, district: dist || '',
    role: isFarmer ? 'farmer' : 'buyer', password: pass,
  });
  if (r?.ok) setTimeout(() => goTo(isFarmer ? 'farmer' : 'buyer'), 800);
}

// পণ্য যোগ (কৃষক)
async function handleAddProduct() {
  if (!Auth.loggedIn()) { showToast('⚠️ লগইন করুন।'); goTo('auth'); return; }
  const fields = document.querySelectorAll('.prod-form-grid input, .prod-form-grid select');
  const name   = fields[0]?.value?.trim();
  const qty    = fields[2]?.value;
  const price  = fields[3]?.value;
  if (!name || !qty || !price) { showToast('⚠️ নাম, পরিমাণ ও দাম দিন।'); return; }

  const fd = new FormData();
  fd.append('name',          name);
  fd.append('quantity_kg',   qty);
  fd.append('price_per_kg',  price);
  if (fields[4]?.value) fd.append('harvest_date', fields[4].value);
  if (fields[5]?.value) fd.append('location',     fields[5].value);
  const desc = document.querySelector('.sc-body .form-textarea')?.value;
  if (desc) fd.append('description', desc);
  const organic = document.querySelector('.sc-body input[type="checkbox"]');
  if (organic?.checked) fd.append('is_organic', 'true');
  const imgInput = document.querySelector('.sc-body input[type="file"]');
  if (imgInput?.files?.[0]) fd.append('image', imgInput.files[0]);

  const ok = await apiCreateProduct(fd);
  if (ok) loadFarmerDashboard();
}

// অর্ডার confirm
async function placeOrder() {
  if (!Auth.loggedIn()) { showToast('⚠️ অর্ডার করতে লগইন করুন।'); goTo('auth'); return; }
  const qty     = parseFloat(document.getElementById('o-qty')?.value);
  const address = document.querySelector('#order-modal textarea')?.value?.trim();
  const note    = document.querySelector('#order-modal input[placeholder*="নির্দেশনা"]')?.value || '';
  if (!qty || qty <= 0)  { showToast('⚠️ পরিমাণ দিন।'); return; }
  if (!address)           { showToast('⚠️ ঠিকানা দিন।'); return; }
  if (!activeProduct?.id) {
    showToast('❌ পণ্য নির্বাচন করা নেই।');
    return;
  }
  const ok = await apiPlaceOrder(activeProduct.id, qty, address, note);
  if (ok) {
    closeModal('order-modal');
    await loadBuyerDashboard();
  }
}

// Chat message পাঠান
window.sendMsg = async function () {
  const inp = document.getElementById('chat-input');
  const txt = inp?.value?.trim();
  if (!txt) return;
  inp.value = '';
  if (activeConvId && Auth.loggedIn()) {
    const socket = connectChatSocket();
    if (socket?.connected) {
      socket.emit('chat:send_message', { conversation_id: activeConvId, text: txt }, (ack) => {
        if (!ack?.ok) showToast('❌ ' + (ack?.error || 'বার্তা পাঠানো যায়নি।'));
      });
    } else {
      const sent = await apiSendMessage(activeConvId, txt);
      if (sent) appendChatMessage(sent);
      else showToast('❌ বার্তা পাঠানো যায়নি।');
    }
  } else {
    // Demo fallback
    if (typeof chatMsgs !== 'undefined') {
      chatMsgs.push({ type: 'sent', text: txt, time: fmtTime(new Date().toISOString()) });
      if (typeof renderChatMsgs === 'function') renderChatMsgs();
    }
  }
};

// অর্ডার accept/reject
async function doAccept(id) { await apiUpdateOrderStatus(id, 'accepted');  loadFarmerDashboard(); }
async function doReject(id) { await apiUpdateOrderStatus(id, 'rejected');  loadFarmerDashboard(); }
async function doDelivered(id) { await apiUpdateOrderStatus(id, 'delivered'); loadFarmerDashboard(); }

// ================================================================
//  11. NAVIGATION HOOK — page খুললে API call
// ================================================================
const _origGoTo = window.goTo;
window.goTo = async function (page) {
  if (page !== 'buyer') stopBuyerOrdersAutoRefresh();
  _origGoTo(page);
  if (page === 'home')     loadHomeProducts();
  if (page === 'products') loadAllProducts();
  if (page === 'farmer')   Auth.loggedIn() ? loadFarmerDashboard() : (_origGoTo('auth'), showToast('⚠️ লগইন করুন।'));
  if (page === 'buyer')    Auth.loggedIn() ? loadBuyerDashboard()  : (_origGoTo('auth'), showToast('⚠️ লগইন করুন।'));
  if (page === 'profile') {
    if (selectedFarmer) renderFarmerProfile(selectedFarmer);
    else {
      const farmers = await apiFarmers();
      if (farmers[0]) renderFarmerProfile(farmers[0]);
    }
  }
  if (page === 'chat')     loadChatPage();
};

async function openOrderModal(id) {
  let product = productLookup.get(Number(id));
  if (!product) {
    const res = await http(`/products/${id}`);
    if (res?.ok) {
      product = await res.json();
      cacheProducts([product]);
    }
  }

  const card = toCardProduct(product);
  if (!card) {
    showToast('❌ পণ্যের তথ্য পাওয়া যায়নি।');
    return;
  }

  activeProduct = { id: card.id, price: card.price };

  const emojiEl = document.getElementById('m-emoji');
  if (emojiEl) {
    emojiEl.innerHTML = `
      <div style="position:relative;width:72px;height:72px;border-radius:12px;overflow:hidden;flex-shrink:0;">
        <img src="${card.img}" alt="${card.name}" style="width:100%;height:100%;object-fit:cover;"
          onerror="this.style.display='none';this.nextElementSibling.style.display='flex';">
        <div style="display:none;width:100%;height:100%;align-items:center;justify-content:center;background:${card.bg};font-size:2.2rem;">${card.emoji}</div>
      </div>`;
  }

  const nameEl = document.getElementById('m-name');
  const farmerEl = document.getElementById('m-farmer');
  const priceEl = document.getElementById('m-price');
  const qtyEl = document.getElementById('o-qty');
  const totalEl = document.getElementById('o-total');
  if (nameEl) nameEl.textContent = card.name;
  if (farmerEl) farmerEl.textContent = `${card.farmer} · ${card.loc}`;
  if (priceEl) priceEl.textContent = `৳${card.price}/কেজি`;
  if (qtyEl) qtyEl.value = '';
  if (totalEl) totalEl.value = '৳০';

  openModal('order-modal');
}

function calcTotal() {
  const qty = parseFloat(document.getElementById('o-qty')?.value) || 0;
  const totalEl = document.getElementById('o-total');
  if (totalEl) {
    totalEl.value = qty > 0 ? `৳${(qty * (activeProduct?.price || 0)).toLocaleString('bn-BD')}` : '৳০';
  }
}

function runVoiceAction(cmdRaw) {
  const cmd = `${cmdRaw || ''}`.trim();
  const c = cmd.toLowerCase();
  const vpText = document.getElementById('vp-text');
  if (vpText) vpText.textContent = `"${cmd}" — প্রক্রিয়া হচ্ছে...`;

  const requireLogin = (targetPage) => {
    if (!Auth.loggedIn()) {
      showToast('⚠️ এই কাজের জন্য লগইন করুন।');
      goTo('auth');
      return false;
    }
    goTo(targetPage);
    return true;
  };

  // Market price command
  if (c.includes('বাজার দর') || c.includes('market')) {
    if (typeof openModal === 'function') openModal('market-modal');
    showToast('💰 বাজার দর দেখাচ্ছি...');
    if (vpText) vpText.textContent = `কমান্ড সম্পন্ন: "${cmd}"`;
    return;
  }

  // Product list command
  if (c.includes('পণ্য') || c.includes('products')) {
    goTo('products');
    showToast('🌾 পণ্য তালিকায় নিয়ে যাচ্ছি...');
    if (vpText) vpText.textContent = `কমান্ড সম্পন্ন: "${cmd}"`;
    return;
  }

  // Specific product search command
  if (c.includes('টমেটো')) {
    goTo('products');
    setTimeout(() => {
      const chip = [...document.querySelectorAll('.chip')].find((el) => el.textContent.includes('শাকসবজি'));
      if (chip && typeof filterChip === 'function') filterChip(chip, 'শাকসবজি');
      const searchInput = document.getElementById('search-input');
      if (searchInput) {
        searchInput.value = 'টমেটো';
        if (typeof filterProds === 'function') filterProds();
      }
    }, 150);
    showToast('🍅 টমেটো খুঁজছি...');
    if (vpText) vpText.textContent = `কমান্ড সম্পন্ন: "${cmd}"`;
    return;
  }

  // Buyer farmers list command
  if (c.includes('কৃষক') || c.includes('কাছের') || c.includes('farmers')) {
    if (requireLogin('buyer')) showToast('📍 কাছের কৃষক দেখাচ্ছি...');
    if (vpText) vpText.textContent = `কমান্ড সম্পন্ন: "${cmd}"`;
    return;
  }

  // My orders command
  if (c.includes('অর্ডার') || c.includes('order')) {
    if (!Auth.loggedIn()) {
      showToast('⚠️ অর্ডার দেখতে লগইন করুন।');
      goTo('auth');
    } else {
      const role = Auth.user()?.role;
      goTo(role === 'farmer' ? 'farmer' : 'buyer');
      showToast('📦 অর্ডার স্ট্যাটাস দেখাচ্ছি...');
    }
    if (vpText) vpText.textContent = `কমান্ড সম্পন্ন: "${cmd}"`;
    return;
  }

  // Chat command
  if (c.includes('চ্যাট') || c.includes('বার্তা') || c.includes('chat')) {
    if (requireLogin('chat')) showToast('💬 চ্যাটে নিয়ে যাচ্ছি...');
    if (vpText) vpText.textContent = `কমান্ড সম্পন্ন: "${cmd}"`;
    return;
  }

  // Profile command
  if (c.includes('প্রোফাইল') || c.includes('profile')) {
    goTo('profile');
    showToast('👤 প্রোফাইল দেখাচ্ছি...');
    if (vpText) vpText.textContent = `কমান্ড সম্পন্ন: "${cmd}"`;
    return;
  }

  // Home command
  if (c.includes('হোম') || c.includes('home')) {
    goTo('home');
    showToast('🏠 হোম পেজে নিয়ে যাচ্ছি...');
    if (vpText) vpText.textContent = `কমান্ড সম্পন্ন: "${cmd}"`;
    return;
  }

  showToast('🤔 কমান্ডটি বুঝতে পারিনি। আবার বলুন।');
  if (vpText) vpText.textContent = `কমান্ড সম্পন্ন: "${cmd}"`;
}

// ================================================================
//  12. NAVBAR UPDATE
// ================================================================
function updateNavbar() {
  const user   = Auth.user();
  const btn    = document.querySelector('.nb.cta');
  const dashBtn = document.getElementById('nav-dashboard-btn');
  if (!btn) return;
  if (dashBtn) {
    if (!user) {
      dashBtn.textContent = '📊 ড্যাশবোর্ড';
      dashBtn.onclick = () => goTo('auth');
    } else if (user.role === 'farmer') {
      dashBtn.textContent = '👨‍🌾 কৃষক ড্যাশবোর্ড';
      dashBtn.onclick = () => goTo('farmer');
    } else {
      dashBtn.textContent = '📦 আমার অর্ডার';
      dashBtn.onclick = () => goTo('buyer');
    }
  }
  if (user) {
    btn.textContent = `👤 ${user.first_name}`;
    btn.onclick = () => {
      if (confirm(`${user.first_name} — লগআউট করবেন?`)) apiLogout();
    };
  } else {
    btn.textContent = 'লগইন / রেজিস্টার';
    btn.onclick = () => goTo('auth');
  }
}

function setupProductImageUpload() {
  const fileInput = document.getElementById('product-image-input');
  const dropzone = document.getElementById('product-upload-dropzone');
  const label = document.getElementById('product-upload-label');
  if (!fileInput || !dropzone || !label) return;

  const updateLabel = () => {
    const file = fileInput.files?.[0];
    label.textContent = file ? `নির্বাচিত ছবি: ${file.name}` : 'ছবি টেনে আনুন বা ক্লিক করুন';
  };

  dropzone.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', updateLabel);

  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.style.borderColor = 'var(--mid-blue)';
  });

  dropzone.addEventListener('dragleave', () => {
    dropzone.style.borderColor = 'var(--gray-200)';
  });

  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.style.borderColor = 'var(--gray-200)';
    const file = e.dataTransfer?.files?.[0];
    if (!file) return;
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) {
      showToast('❌ শুধু JPG, PNG, WEBP ছবি আপলোড করুন।');
      return;
    }
    const dt = new DataTransfer();
    dt.items.add(file);
    fileInput.files = dt.files;
    updateLabel();
  });
}

// ================================================================
//  13. BACKEND HEALTH CHECK
// ================================================================
async function checkBackend() {
  const banner = document.getElementById('backend-banner');
  try {
    const res = await fetch(`${API_BASE}/health`, { signal: AbortSignal.timeout(3000) });
    if (res.ok) {
      if (banner) banner.style.display = 'none';
      console.log('%c✅ Node.js Backend সংযুক্ত!', 'color:green;font-weight:bold;');
      return true;
    }
  } catch {}
  if (banner) banner.style.display = 'flex';
  console.warn('%c⚠️ Backend নেই — Demo Mode', 'color:orange;font-weight:bold;');
  return false;
}

// ================================================================
//  14. INIT
// ================================================================
document.addEventListener('DOMContentLoaded', async () => {
  window.openOrderModal = openOrderModal;
  window.calcTotal = calcTotal;
  window.voiceCmd = runVoiceAction;
  updateNavbar();
  setupProductImageUpload();
  if (Auth.loggedIn()) connectChatSocket();
  const backendOk = await checkBackend();

  if (backendOk) {
    loadHomeProducts();
    loadAllProducts();
  } else {
    // Demo data fallback
    if (typeof products !== 'undefined') {
      renderProds(products.slice(0, 4), 'home-prod-grid');
      renderProds(products, 'products-grid');
    }
    if (typeof renderMarket    === 'function') renderMarket();
    if (typeof renderTicker    === 'function') renderTicker();
    if (typeof renderChatMsgs  === 'function') renderChatMsgs();
  }
});

window.addEventListener('beforeunload', () => {
  stopBuyerOrdersAutoRefresh();
});

console.log('%c🌾 কৃষকবাজার — Node.js API Connector', 'color:#1d4ed8;font-weight:bold;font-size:14px;');
console.log(`%c📡 Backend: ${API_BASE}`, 'color:#16a34a;');
