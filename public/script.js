const socket = io();
const output = document.getElementById('output');
const downloadButton = document.getElementById('downloadButton');
const settingsModal = document.getElementById("settingsModal");
const settingsButton = document.getElementById("settingsButton");
const clearButton = document.getElementById("clearButton");
const cancelButton = document.getElementById("cancelButton");
const span = document.getElementsByClassName("close")[0];
const saveSettingsButton = document.getElementById("saveSettingsButton");
const selectedFileTypes = [];

let maxDepth = 50;
let maxRecursive = 5;
let isDownloading = false;
let recursive = true;  // Default value for recursive

settingsButton.onclick = function () {
    settingsModal.style.display = "block";
};

span.onclick = function () {
    settingsModal.style.display = "none";
};

window.onclick = function (event) {
    if (event.target == settingsModal) {
        settingsModal.style.display = "none";
    }
};

saveSettingsButton.onclick = function () {
    const htmlCheckbox = document.getElementById('htmlCheckbox');
    const cssCheckbox = document.getElementById('cssCheckbox');
    const jsCheckbox = document.getElementById('jsCheckbox');
    const imagesCheckbox = document.getElementById('imagesCheckbox');
    const mediaCheckbox = document.getElementById('mediaCheckbox');
    const recursiveCheckbox = document.getElementById('recursiveCheckbox');  // Get recursive checkbox
    const maxDepthInput = document.getElementById('maxDepthInput');
    const RecursiveInput = document.getElementById('RecursiveInput');

    selectedFileTypes.length = 0;

    if (htmlCheckbox.checked) selectedFileTypes.push('html');
    if (cssCheckbox.checked) selectedFileTypes.push('css');
    if (jsCheckbox.checked) selectedFileTypes.push('js');
    if (imagesCheckbox.checked) selectedFileTypes.push('images');
    if (mediaCheckbox.checked) selectedFileTypes.push('media');

    maxDepth = parseInt(maxDepthInput.value) || 50;
    maxRecursive = parseInt(RecursiveInput.value) || 5;
    recursive = recursiveCheckbox.checked;  // Set recursive value based on checkbox
    settingsModal.style.display = "none";
};

document.getElementById('downloadForm').addEventListener('submit', (e) => {
    e.preventDefault();
    if (isDownloading) return;

    output.innerHTML = '';
    downloadButton.style.display = 'none';
    cancelButton.style.display = 'block';
    isDownloading = true;

    const websiteUrl = document.getElementById('websiteUrl').value;
    const directoryName = document.getElementById('directoryName').value;
    socket.emit('startDownload', { websiteUrl, directoryName, selectedFileTypes, maxDepth, recursive, maxRecursive });
});

cancelButton.onclick = function () {
    if (isDownloading) {
        socket.emit('cancelDownload');
        output.scrollTop = output.scrollHeight;
        cancelButton.style.display = 'none';
        isDownloading = false;
    }
};

socket.on('log', (data) => {
    output.innerHTML += `${data.message}\n`;
    output.style.display = 'block';
    output.scrollTop = output.scrollHeight;
});

socket.on('downloadReady', (downloadUrl) => {
    downloadButton.style.display = 'block';
    cancelButton.style.display = 'none';
    isDownloading = false;
    downloadButton.onclick = () => {
        window.location.href = downloadUrl;
    };
});

clearButton.onclick = function () {
    output.innerHTML = '';
    downloadButton.style.display = 'none';
    output.style.display = 'none';
};
