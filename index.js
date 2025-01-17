const socket = io();

// Variables
const directionSections = 64; // Number of sections in the compass

const sendLocation = (latlng) => {
    console.log(`emit location ${latlng}`);
    socket.emit('location', latlng);
}

const saveConfig = (key, value) => {
    localStorage.setItem(`kinesis-${key}`, value);
}

const loadConfig = (key, fallback) => {
    const value = localStorage.getItem(`kinesis-${key}`);
    if (!value) {
        saveConfig(key, fallback);
    }
    return value ? value : fallback;
}

const center = L.latLng(loadConfig('latitude', 53.338228), loadConfig('longitude', -6.259323));

const map = L.map('map', {
    center: center,
    zoom: loadConfig('zoom', 12),
    doubleClickZoom: false,
});

const tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a>'
}).addTo(map);

let marker = null;
let markerLastPos = null;
let markerShadowPos = null;

const path = L.polyline([], {color: 'red'}).addTo(map);
let stepIndex = 0; // index of next step of path
let speed = 1; // speed unit meter per second
let loop = 'off'; // off; loop; uturn
let pause = false;

const tickInterval = 1000; // update location per 1000ms
const randomFactor = 0.2; // +-20% of origin value

const tick = setInterval(function() {
    navigate();
}, tickInterval);

const updateRadio = (name, value) => {
    document.getElementsByName(name).forEach((element) => {
        element.checked = element.value == value;
    });
}

const setSpeed = (v) => {
    updateRadio('speedChoice', v);
    speed = v;
}
setSpeed(speed);

const setLoop = (v) => {
    updateRadio('loopChoice', v);
    loop = v;
}
setLoop(loop);

const setPause = (v) => {
    document.getElementById('pauseSwitch').checked = v;
    pause = v;
}
setPause(pause);

document.addEventListener('keydown', (event) => {
    if (event.code === 'Space') {
        pause = !pause;
        setPause(pause);
    }
});

// Add event listener to the speed input element
const speedInput = document.getElementById('speed');
speedInput.addEventListener('input', (event) => {
    const newSpeed = parseInt(event.target.value);
    if (!isNaN(newSpeed)) {
        setSpeed(newSpeed);
    }
});

document.getElementById('undoButton').addEventListener('click', deleteStep);
document.getElementById('stopButton').addEventListener('click', clearSteps);

document.getElementById('pauseSwitch').addEventListener('change', () => {
    pause = document.getElementById('pauseSwitch').checked;
    console.log(`pause ${pause}`)
});

document.getElementsByName('speedChoice').forEach((element) => {
    element.addEventListener('click', () => {
        speed = element.value;
        console.log(`speed ${speed}`)
    });
});

document.getElementsByName('loopChoice').forEach((element) => {
    element.addEventListener('click', () => {
        loop = element.value;
        console.log(`loop ${loop}`);
    });
});

const setDirectTeleport = () => {
    const value = document.getElementById("coordinates").value;

    if(value.length <= 1) return;

    // Light validation to see if input looks kinda like GPS coordinates
    const coordinatePattern = /^-?\d+(\.\d+)?,\s?-?\d+(\.\d+)?$/;
    if (!coordinatePattern.test(value)) {
        alert("Invalid GPS coordinates, should look like: 53.338228, -6.259323")
        return;
    }

    const coords = value.split(',');
    if(coords.length !== 2) return;

    const lat = parseFloat(coords[0]);
    const lng = parseFloat(coords[1]);
    const latlng = {lat, lng};

    if (!initMain({latlng}, true)) {
        teleport(latlng, true);
    }
}

map.on('click', function(e) {
    if (!initMain(e)) {
        addStep(e.latlng);
    }
});

map.on('zoomend', function () {
    saveConfig('zoom', map.getZoom());
});

map.on('moveend', function() {
    const c = map.getCenter();
    saveConfig('latitude', c.lat);
    saveConfig('longitude', c.lng);
});

const GeoSearchControl = window.GeoSearch.GeoSearchControl;
const OpenStreetMapProvider = window.GeoSearch.OpenStreetMapProvider;
const provider = new OpenStreetMapProvider();
const searchControl = new GeoSearchControl({
    provider: provider,
});
map.addControl(searchControl);
const searchHandler = (result) => {
    marker = null;
    path.setLatLngs([]);
    stepIndex = 0;

    const event = { latlng: { lat: result.location.y, lng: result.location.x} }
    if (!initMain(event)) {
        addStep(event.latlng);
    }
}
map.on('geosearch/showlocation', searchHandler);


const random = (x) => {
    const factor = 1 + randomFactor * (Math.random() * 2 - 1);
    return x * factor;
}


// return true if initialized marker, false if already initialized
function initMain(e) {
    if (marker === null) {
        marker = L.marker(e.latlng, {draggable: true});
        if (teleport(e.latlng)) {
            marker.addTo(map);

            marker.on('mousedown', function(e) {
                markerLastPos = e.latlng;
            });

            marker.on('mouseup', function(e) {
                if (!teleport(e.latlng)) {
                    marker.setLatLng(markerLastPos);
                }
            });

        } else {
            // rollback so we can init it again
            marker = null;
        }
        return true;
    }
    return false
}


// return true if teleported, false if canceled teleportation
function teleport(latlng) {
    const choice = confirm('Teleport?')
    if (choice) {
        marker.setLatLng(latlng);
        markerShadowPos = latlng;
        sendLocation(`${markerShadowPos.lat},${markerShadowPos.lng}`)
        clearSteps();
        map.panTo(latlng);
    }
    return choice;
}


// move towards target with distance meters
function move(target, distance) {
    if (distance != 0) {
        const start = markerShadowPos;
        const newPos = geolib.computeDestinationPoint(start, distance, geolib.getGreatCircleBearing(start, target))
        const newLatlng = L.latLng(newPos.latitude, newPos.longitude);

        // check if it's too far
        const dis1 = map.distance(start, target);
        const dis2 = map.distance(start, newLatlng);

        if (dis2 > dis1) {
            // we just move to destination
            markerShadowPos = target;
        } else {
            markerShadowPos = newLatlng;
        }
    }

    // set a random location
    const randomDistance = distance * randomFactor;
    const randomLocation = geolib.computeDestinationPoint(markerShadowPos, randomDistance, Math.random() * 360);
    const randomLatlng = L.latLng(randomLocation.latitude, randomLocation.longitude);

    sendLocation(`${randomLatlng.lat},${randomLatlng.lng}`)
    marker.setLatLng(randomLatlng);
}


function addStep(latlng) {
    console.log(`add ${latlng.lat},${latlng.lng}`);
    path.addLatLng(latlng);
}


function deleteStep() {
    const pathLatlngs = path.getLatLngs();
    if (pathLatlngs.length > 1 && stepIndex !== pathLatlngs.length - 1) {
        const deleted = pathLatlngs.pop();
        console.log(`deleted ${deleted.lat},${deleted.lng}`);
        path.setLatLngs([...pathLatlngs]);
    }
}


function clearSteps() {
    if (marker) {
        console.log(`clear path`);
        path.setLatLngs([marker.getLatLng()]);
        stepIndex = 0;
    }
}

let walkDirection = 0; // 0: current direction, -1: left, 1: right
let walkActive = false;

// Add the following code after the calculateNewDirection function

// Get the SVG element from the HTML file
const arrowElement = document.getElementById('arrow');


// Function to update the arrow direction
function updateArrowDirection(direction) {
    // Rotate the arrow element based on the direction
    const degrees = ((360 / directionSections) * walkDirection) % 360; // Calculate direction in degrees
    arrowElement.style.transform = `rotate(${degrees}deg)`;
}

// Call the updateArrowDirection function inside the calculateNewDirection function
function calculateNewDirection(direction, increment) {
    const newDirection = direction + increment;
    let val;
    if (newDirection >= 0) {
        val = newDirection % directionSections; // Use modular arithmetic with directionSections sections
    } else {
        val = (directionSections + (newDirection % directionSections)) % directionSections; // Use modular arithmetic with directionSections sections
    }
    console.log(`val: ${val}`);
    updateArrowDirection(val * (360 / directionSections)); // Update the arrow direction by converting to degrees
    return val;
}

document.addEventListener('keydown', (event) => {
    if (event.key === 'j' || event.key === 'ArrowLeft') {
        event.preventDefault(); // Prevent default behavior of arrow keys
        walkDirection = calculateNewDirection(walkDirection, -1);
    } else if (event.key === 'l' || event.key === 'ArrowRight') {
        event.preventDefault(); // Prevent default behavior of arrow keys
        walkDirection = calculateNewDirection(walkDirection, 1);
    } else if (event.key === 'p') {
        walkActive = !walkActive;
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        event.preventDefault(); // Prevent default behavior of arrow keys
    }
});

function calculateNewLatLng(latlng, deegre, distance) {
    const direction = deegre * Math.PI / 180; // Convert direction to radians
    const R = 6371000; // Earth's radius in meters
    const lat1 = latlng.lat * Math.PI / 180; // Convert latitude to radians
    const lng1 = latlng.lng * Math.PI / 180; // Convert longitude to radians
    const angularDistance = distance / R; // Convert distance to angular distance

    const lat2 = Math.asin(Math.sin(lat1) * Math.cos(angularDistance) +
        Math.cos(lat1) * Math.sin(angularDistance) * Math.cos(direction));
    const lng2 = lng1 + Math.atan2(Math.sin(direction) * Math.sin(angularDistance) * Math.cos(lat1),
        Math.cos(angularDistance) - Math.sin(lat1) * Math.sin(lat2));

    return {
        lat: lat2 * 180 / Math.PI, // Convert latitude back to degrees
        lng: lng2 * 180 / Math.PI, // Convert longitude back to degrees
    };
}

function navigate() {
    const pathLatlngs = path.getLatLngs();
    if (loop === 'directional') {
        if (pause) {
            move(markerShadowPos, 0); // stay
        } else {
            const degrees = ((360 / directionSections) * walkDirection) % 360; // Calculate direction in degrees
            const distance = speed; // Set the distance in meters using the speed variable
            console.log(`walk: ${degrees} ${distance}`);
            const latlng = calculateNewLatLng(markerShadowPos, degrees, distance); // Calculate new latlng based on direction and distance
            path.setLatLngs([markerShadowPos]); // Update the path with the new latlng
            move(latlng, distance); // Move towards the new latlng with the specified distance
        }
    } else if (stepIndex < pathLatlngs.length) {
        if (pause) {
            move(markerShadowPos, 0); // stay
        } else {
            const stepLatlng = pathLatlngs[stepIndex];
            // check if we're already at the goal
            if (stepLatlng.equals(markerShadowPos)) {
                // check if it's last step
                if (stepIndex >= pathLatlngs.length - 1) {
                    switch (loop) {
                        case 'loop':
                            console.log(`loop: move to start`);
                            stepIndex = 0;
                            break;
                        case 'uturn':
                            console.log(`loop: make uturn`);
                            path.setLatLngs([...pathLatlngs.reverse()]);
                            stepIndex = 1;
                            break;
                        case 'off':
                            default:
                                console.log(`loop: off`);
                                move(stepLatlng, 0); // stay
                                break;
                    }
                } else {
                    stepIndex++;
                }
            } else {
                move(stepLatlng, stepLatlng.distanceTo(markerShadowPos));
            }
        }
    }
}


// function navigate() {
//     const pathLatlngs = path.getLatLngs();
//     if (stepIndex < pathLatlngs.length) {
//         if (pause) {
//             move(markerShadowPos, 0); // stay
//         } else {
//             const stepLatlng = pathLatlngs[stepIndex];
//             // check if we're already at the goal
//             if (stepLatlng.equals(markerShadowPos)) {
//                 // check if it's last step
//                 if (stepIndex >= pathLatlngs.length - 1) {
//                     switch (loop) {
//                         case 'loop':
//                             console.log(`loop: move to start`);
//                             stepIndex = 0;
//                             break;
//                         case 'uturn':
//                             console.log(`loop: make uturn`);
//                             path.setLatLngs([...pathLatlngs.reverse()]);
//                             stepIndex = 1;
//                             break;
//                         case 'off':
//                         default:
//                             console.log(`loop: off`);
//                             move(stepLatlng, 0); // stay
//                             break;
//                     }
//                 } else {
//                     stepIndex += 1; // proceed with next step
//                 }
//             } else {
//                 move(stepLatlng, random(speed) * tickInterval / 1000);
//             }
//         }
//     }
// }
