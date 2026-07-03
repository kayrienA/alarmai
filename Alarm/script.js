const MODEL_URL = "https://teachablemachine.withgoogle.com/models/8uvVbxd-O/";

// Threshold persentase deteksi agar dianggap berhasil (0.0 sampai 1.0)
const CONFIDENCE_THRESHOLD = 0.85;
// Berapa lama (dalam milidetik) barang harus ditahan agar alarm berhenti
const REQUIRED_HOLD_TIME_MS = 2000;

// --- Variabel Global ---
let model, webcam, maxPredictions;
let modelLabels = [];
let alarmTime = null;
let alarmInterval = null;
let isAlarmRinging = false;
let isModelLoaded = false;
let targetLabel = "";
let detectionStartTime = 0;
let isDetectingSuccess = false;
let alarmPicker = null; // Flatpickr instance

// Audio Context untuk menghasilkan suara alarm (Web Audio API)
let audioCtx;
let oscillatorBox = [];
let beepInterval;

// --- DOM Elements ---
const setupSection = document.getElementById('setup-section');
const alarmSection = document.getElementById('alarm-section');
const loadingOverlay = document.getElementById('loading-overlay');
const alarmTimeInput = document.getElementById('alarm-time');
const btnSaveAlarm = document.getElementById('btn-save-alarm');
const btnCancelAlarm = document.getElementById('btn-cancel-alarm');
const activeAlarmDisplay = document.getElementById('active-alarm-display');
const displayTime = document.getElementById('display-time');
const labelListUI = document.getElementById('label-list');
const targetObjectUI = document.getElementById('target-object');
const webcamContainer = document.getElementById('webcam-container');
const cameraOverlay = document.querySelector('.camera-overlay');
const cameraStatus = document.getElementById('camera-status');
const progressBarsContainer = document.getElementById('progress-bars-container');
const successMessage = document.getElementById('success-message');

// --- Inisialisasi ---
async function init() {
    // Inisialisasi Flatpickr di sini agar tersedia untuk semua fungsi
    alarmPicker = flatpickr("#alarm-time", {
        enableTime: true,
        noCalendar: true,
        dateFormat: "H:i",
        time_24hr: true,
        defaultDate: "06:00",
        minuteIncrement: 1,
        disableMobile: "true"
    });

    // Buka popup ketika icon atau container diklik
    const pickerContainer = document.getElementById('time-picker-container');
    if (pickerContainer) {
        pickerContainer.addEventListener('click', () => {
            alarmPicker.open();
        });
    }

    try {
        // Load model dari URL
        const modelURL = MODEL_URL + "model.json";
        const metadataURL = MODEL_URL + "metadata.json";

        model = await tmImage.load(modelURL, metadataURL);
        maxPredictions = model.getTotalClasses();
        isModelLoaded = true;

        // Ambil label-label yang bisa dideteksi model
        modelLabels = model.getClassLabels();

        // Tampilkan daftar label di UI
        updateLabelListUI();

        // Sembunyikan loading overlay
        loadingOverlay.classList.remove('active');

        // Cek LocalStorage untuk alarm tersimpan
        checkSavedAlarm();

        // Inisialisasi AudioContext (dibuat di sini tapi di-resume nanti saat user interaksi)
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        audioCtx = new AudioContext();

    } catch (error) {
        console.error("Gagal memuat model:", error);
        alert("Gagal memuat model AI. Pastikan URL model benar dan kamu memiliki koneksi internet.");
        document.querySelector('.spinner').style.display = 'none';
        document.querySelector('#loading-overlay p').innerText = "Gagal memuat model. Silakan periksa konsol dan refresh halaman.";
    }
}

function updateLabelListUI() {
    labelListUI.innerHTML = "";
    if (modelLabels.length === 0) {
        labelListUI.innerHTML = "<li>Tidak ada label ditemukan pada model.</li>";
        return;
    }
    modelLabels.forEach(label => {
        const li = document.createElement('li');
        li.textContent = label;
        labelListUI.appendChild(li);
    });
}

// --- Logika Alarm ---

btnSaveAlarm.addEventListener('click', () => {
    // Baca waktu dari Flatpickr (bukan dari value input mentah)
    // agar format selalu konsisten dengan zero-padding (HH:MM)
    if (!alarmPicker || !alarmPicker.selectedDates || alarmPicker.selectedDates.length === 0) {
        alert("Silakan atur waktu alarm terlebih dahulu!");
        return;
    }

    const selectedDate = alarmPicker.selectedDates[0];
    const hours = selectedDate.getHours().toString().padStart(2, '0');
    const minutes = selectedDate.getMinutes().toString().padStart(2, '0');
    const timeValue = `${hours}:${minutes}`;

    // Simpan ke local storage
    localStorage.setItem('alarmTime', timeValue);
    setAlarm(timeValue);

    // Resume audio context jika browser me-suspend-nya
    if (audioCtx && audioCtx.state === 'suspended') {
        audioCtx.resume();
    }
});

btnCancelAlarm.addEventListener('click', () => {
    cancelAlarm();
});

function setAlarm(timeStr) {
    alarmTime = timeStr;

    // Update UI
    displayTime.textContent = timeStr;
    activeAlarmDisplay.classList.remove('hidden');
    btnCancelAlarm.classList.remove('hidden');
    btnSaveAlarm.textContent = "Ubah Waktu Alarm";

    // Mulai pengecekan waktu setiap detik
    if (alarmInterval) clearInterval(alarmInterval);

    alarmInterval = setInterval(() => {
        const now = new Date();
        const currentHours = now.getHours().toString().padStart(2, '0');
        const currentMinutes = now.getMinutes().toString().padStart(2, '0');
        const currentTime = `${currentHours}:${currentMinutes}`;

        if (currentTime === alarmTime && !isAlarmRinging) {
            triggerAlarm();
        }
    }, 1000);
}

function cancelAlarm() {
    localStorage.removeItem('alarmTime');
    alarmTime = null;
    if (alarmInterval) clearInterval(alarmInterval);
    alarmInterval = null;

    // Reset UI
    activeAlarmDisplay.classList.add('hidden');
    btnCancelAlarm.classList.add('hidden');
    btnSaveAlarm.textContent = "Simpan Alarm";

    // Gunakan Flatpickr API untuk reset tampilan picker (bukan .value langsung)
    if (alarmPicker) {
        alarmPicker.setDate("06:00", false);
    }
}

function checkSavedAlarm() {
    const savedTime = localStorage.getItem('alarmTime');
    if (savedTime) {
        // Gunakan Flatpickr API agar tampilan picker ikut terupdate
        if (alarmPicker) {
            alarmPicker.setDate(savedTime, false); // false = jangan trigger onChange
        }
        setAlarm(savedTime);
    }
}

// --- Aksi Saat Alarm Berbunyi ---

async function triggerAlarm() {
    isAlarmRinging = true;
    isDetectingSuccess = false;

    if (alarmInterval) clearInterval(alarmInterval);

    const randomIndex = Math.floor(Math.random() * modelLabels.length);
    targetLabel = modelLabels[randomIndex];

    setupSection.classList.add('hidden');
    alarmSection.classList.remove('hidden');
    targetObjectUI.textContent = targetLabel;
    successMessage.classList.add('hidden');

    playAlarmSound();

    setupProgressBars();

    await setupWebcam();
}

function setupProgressBars() {
    progressBarsContainer.innerHTML = '';
    modelLabels.forEach((label, index) => {
        const item = document.createElement('div');
        item.className = 'progress-item';

        const isTarget = label === targetLabel;
        const targetIcon = isTarget ? ' 🎯 (Target)' : '';
        const nameColor = isTarget ? 'var(--accent)' : 'var(--text-main)';

        item.innerHTML = `
            <div class="progress-header">
                <span class="progress-label" style="color: ${nameColor}">${label}${targetIcon}</span>
                <span class="progress-value" id="val-${index}">0%</span>
            </div>
            <div class="progress-bar-bg">
                <div class="progress-bar-fill" id="bar-${index}"></div>
            </div>
        `;
        progressBarsContainer.appendChild(item);
    });
}


async function setupWebcam() {
    cameraOverlay.classList.remove('hidden');
    cameraStatus.textContent = "Mengaktifkan kamera...";

    const flip = true;
    webcam = new tmImage.Webcam(400, 300, flip);

    try {
        await webcam.setup({ facingMode: "user" }); // request access to the webcam
        await webcam.play();
        window.requestAnimationFrame(loop);

        webcamContainer.innerHTML = '';
        webcamContainer.appendChild(webcam.canvas);

        cameraOverlay.classList.add('hidden');
    } catch (err) {
        console.error("Akses kamera ditolak atau gagal:", err);
        cameraStatus.textContent = "Akses kamera ditolak. Izinkan kamera di browser.";
    }
}

async function loop() {
    if (!isAlarmRinging) return;

    webcam.update();
    if (!isDetectingSuccess) {
        await predict();
    }
    window.requestAnimationFrame(loop);
}

async function predict() {
    // Memprediksi frame dari kamera
    const prediction = await model.predict(webcam.canvas);

    let isTargetFoundNow = false;

    for (let i = 0; i < maxPredictions; i++) {
        const p = prediction[i];
        const probPercent = Math.round(p.probability * 100);

        // Update progress bar
        const bar = document.getElementById(`bar-${i}`);
        const val = document.getElementById(`val-${i}`);

        if (bar && val) {
            bar.style.width = probPercent + "%";
            val.textContent = probPercent + "%";

            // Ubah warna bar target jika melebih threshold
            if (p.className === targetLabel) {
                if (p.probability >= CONFIDENCE_THRESHOLD) {
                    bar.style.backgroundColor = "var(--success)";
                    isTargetFoundNow = true;
                } else {
                    bar.style.backgroundColor = "var(--accent)";
                }
            } else {
                bar.style.backgroundColor = "var(--primary)";
            }
        }
    }

    // Logika penghentian alarm jika barang terdeteksi beberapa detik
    if (isTargetFoundNow) {
        if (detectionStartTime === 0) {
            detectionStartTime = Date.now(); // Mulai hitung waktu
        } else {
            const timeElapsed = Date.now() - detectionStartTime;
            if (timeElapsed >= REQUIRED_HOLD_TIME_MS) {
                stopAlarmSuccess();
            }
        }
    } else {
        // Reset waktu jika confidence turun
        detectionStartTime = 0;
    }
}

// --- Suara Alarm (Web Audio API) ---

function playAlarmSound() {
    if (!audioCtx) return;

    // Pola bip-bip alarm digital
    beepInterval = setInterval(() => {
        if (!isAlarmRinging) return;

        const osc = audioCtx.createOscillator();
        const gainNode = audioCtx.createGain();

        osc.type = 'square';
        osc.frequency.setValueAtTime(800, audioCtx.currentTime); // 800Hz beep

        // Envelope untuk suara beep pendek
        gainNode.gain.setValueAtTime(0, audioCtx.currentTime);
        gainNode.gain.linearRampToValueAtTime(0.5, audioCtx.currentTime + 0.05);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.3);

        osc.connect(gainNode);
        gainNode.connect(audioCtx.destination);

        osc.start(audioCtx.currentTime);
        osc.stop(audioCtx.currentTime + 0.3);
    }, 600); // bunyi setiap 600ms
}

function stopAlarmSound() {
    if (beepInterval) {
        clearInterval(beepInterval);
    }
}

// --- Berhasil Mematikan Alarm ---

function stopAlarmSuccess() {
    isDetectingSuccess = true;
    isAlarmRinging = false;

    stopAlarmSound();

    // Tampilkan pesan sukses
    successMessage.classList.remove('hidden');
    document.querySelector('.alert-banner h2').textContent = "ALARM DIMATIKAN";
    document.querySelector('.alert-banner').style.backgroundColor = "var(--success)";
    document.querySelector('.alert-banner').style.animation = "none";

    // matikan kamera setelah beberapa detik dan kembali ke menu awal
    setTimeout(() => {
        if (webcam) {
            webcam.stop();
        }

        // Reset state
        cancelAlarm();
        setupSection.classList.remove('hidden');
        alarmSection.classList.add('hidden');

        // Kembalikan style banner
        document.querySelector('.alert-banner h2').textContent = "ALARM BERBUNYI!";
        document.querySelector('.alert-banner').style.backgroundColor = "var(--danger)";
        document.querySelector('.alert-banner').style.animation = "pulseRed 2s infinite";

    }, 4000);
}

// Jalankan inisialisasi saat script dimuat
window.onload = init;

// =============================================
//   ANIMATED BACKGROUND: Grid + Particles
// =============================================
function initBackground() {
    const canvas = document.getElementById('bg-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    const PARTICLE_COUNT = 60;
    const CONNECTION_DISTANCE = 130;
    let particles = [];
    let animFrameId;

    function resize() {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
    }

    class Particle {
        constructor() { this.reset(true); }
        reset(randomY = false) {
            this.x = Math.random() * canvas.width;
            this.y = randomY ? Math.random() * canvas.height : canvas.height + 10;
            this.vx = (Math.random() - 0.5) * 0.35;
            this.vy = (Math.random() - 0.5) * 0.35;
            this.radius = Math.random() * 1.4 + 0.4;
            this.baseOpacity = Math.random() * 0.45 + 0.12;
            this.phase = Math.random() * Math.PI * 2;
            this.phaseSpeed = 0.007 + Math.random() * 0.013;
        }
        update() {
            this.x += this.vx;
            this.y += this.vy;
            this.phase += this.phaseSpeed;
            // Wrap-around edges
            if (this.x < -5) this.x = canvas.width + 5;
            if (this.x > canvas.width + 5) this.x = -5;
            if (this.y < -5) this.y = canvas.height + 5;
            if (this.y > canvas.height + 5) this.y = -5;
        }
        draw() {
            const opacity = this.baseOpacity + Math.sin(this.phase) * 0.1;
            ctx.save();
            ctx.shadowBlur = 10;
            ctx.shadowColor = 'rgba(99, 180, 255, 0.85)';
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(167, 215, 255, ${opacity})`;
            ctx.fill();
            ctx.restore();
        }
    }

    function drawGrid() {
        const size = 65;
        ctx.save();
        ctx.lineWidth = 0.5;
        // Vertical lines
        for (let x = 0; x <= canvas.width; x += size) {
            ctx.beginPath();
            ctx.strokeStyle = `rgba(59, 130, 246, ${x % (size * 4) === 0 ? 0.08 : 0.04})`;
            ctx.moveTo(x, 0);
            ctx.lineTo(x, canvas.height);
            ctx.stroke();
        }
        // Horizontal lines
        for (let y = 0; y <= canvas.height; y += size) {
            ctx.beginPath();
            ctx.strokeStyle = `rgba(59, 130, 246, ${y % (size * 4) === 0 ? 0.08 : 0.04})`;
            ctx.moveTo(0, y);
            ctx.lineTo(canvas.width, y);
            ctx.stroke();
        }
        ctx.restore();
    }

    function drawConnections() {
        ctx.save();
        for (let i = 0; i < particles.length; i++) {
            for (let j = i + 1; j < particles.length; j++) {
                const dx = particles[i].x - particles[j].x;
                const dy = particles[i].y - particles[j].y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist < CONNECTION_DISTANCE) {
                    const alpha = (1 - dist / CONNECTION_DISTANCE) * 0.14;
                    ctx.beginPath();
                    ctx.moveTo(particles[i].x, particles[i].y);
                    ctx.lineTo(particles[j].x, particles[j].y);
                    ctx.strokeStyle = `rgba(99, 160, 255, ${alpha})`;
                    ctx.lineWidth = 0.6;
                    ctx.stroke();
                }
            }
        }
        ctx.restore();
    }

    function animate() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        drawGrid();
        drawConnections();
        particles.forEach(p => { p.update(); p.draw(); });
        animFrameId = requestAnimationFrame(animate);
    }

    resize();
    window.addEventListener('resize', () => {
        resize();
        // Re-distribute particles after resize
        particles.forEach(p => p.reset(true));
    });

    for (let i = 0; i < PARTICLE_COUNT; i++) particles.push(new Particle());
    animate();
}

// Jalankan animasi background segera (sebelum AI model selesai dimuat)
initBackground();
