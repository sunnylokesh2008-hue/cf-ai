from __future__ import annotations

from collections import deque
from dataclasses import dataclass, asdict
from heapq import heappop, heappush
from math import hypot
from time import perf_counter
from typing import Dict, Iterable, List, Optional, Tuple

try:
    from flask import Flask, jsonify, render_template, request
except ImportError as exc:  # pragma: no cover - helps viva/debugging on fresh machines.
    raise SystemExit("Flask is required. Install it with: pip install flask") from exc


app = Flask(__name__)


@dataclass
class Node:
    id: str
    name: str
    type: str
    x: float
    y: float
    population: int = 0
    demand: int = 0
    priority: int = 0
    risk: int = 0
    stock: int = 0


@dataclass
class Road:
    id: str
    a: str
    b: str
    cost: int
    blocked: bool = False
    road_type: str = "district"


@dataclass
class Vehicle:
    id: str
    type: str
    at: str
    capacity: int
    fuel: int
    speed: int
    range_km: int
    status: str = "READY"


ALGORITHM_INFO = {
    "BFS": {
        "name": "Breadth First Search",
        "definition": "A blind search strategy that explores the graph level by level.",
        "principle": "Maintains a FIFO queue. The earliest discovered route frontier is expanded first.",
        "advantages": "Complete on finite graphs and optimal when every road has equal cost.",
        "disadvantages": "Consumes significant memory and ignores weighted road distance.",
        "time": "O(V + E)",
        "space": "O(V)",
    },
    "DFS": {
        "name": "Depth First Search",
        "definition": "A blind search strategy that explores one branch deeply before backtracking.",
        "principle": "Maintains a LIFO stack. The most recently discovered node is expanded first.",
        "advantages": "Memory efficient and simple to explain.",
        "disadvantages": "Can miss cheaper routes and may dive into poor branches.",
        "time": "O(V + E)",
        "space": "O(V)",
    },
    "DLS": {
        "name": "Depth Limited Search",
        "definition": "Depth-first search with a maximum depth boundary.",
        "principle": "Stops expanding a branch once it reaches the configured limit.",
        "advantages": "Prevents infinite depth and makes DFS controllable.",
        "disadvantages": "Fails when the solution is deeper than the limit.",
        "time": "O(b^l)",
        "space": "O(bl)",
    },
    "IDS": {
        "name": "Iterative Deepening Search",
        "definition": "Repeated DLS with gradually increasing depth.",
        "principle": "Runs depth limits 0, 1, 2... until the target is reached.",
        "advantages": "BFS-like completeness with DFS-like memory use.",
        "disadvantages": "Repeats shallow expansions.",
        "time": "O(b^d)",
        "space": "O(bd)",
    },
    "UCS": {
        "name": "Uniform Cost Search",
        "definition": "Search that expands the lowest cumulative path cost first.",
        "principle": "Uses a priority queue ordered by cost already travelled.",
        "advantages": "Optimal for non-negative weighted roads.",
        "disadvantages": "Can explore many low-cost detours before moving toward the target.",
        "time": "O(E log V)",
        "space": "O(V)",
    },
    "Greedy": {
        "name": "Greedy Best First Search",
        "definition": "Heuristic search that moves toward the node estimated closest to the target.",
        "principle": "Uses straight-line distance to the goal as the priority.",
        "advantages": "Fast and visually intuitive.",
        "disadvantages": "Not optimal because it ignores path cost already paid.",
        "time": "O(E log V)",
        "space": "O(V)",
    },
    "A*": {
        "name": "A* Search",
        "definition": "Informed search combining cumulative cost and estimated remaining distance.",
        "principle": "Expands the node with the best f(n) = g(n) + h(n).",
        "advantages": "Efficient and optimal when the heuristic is admissible.",
        "disadvantages": "Requires a useful heuristic and still stores frontier state.",
        "time": "O(E log V)",
        "space": "O(V)",
    },
}


def default_scenario() -> dict:
    nodes = [
        Node("HQ", "NATIONAL DISASTER HQ", "command", 235, 235, stock=42000, risk=4),
        Node("CC", "CENTRAL COMMAND", "command", 520, 358, stock=18000, risk=10),
        Node("NC", "REGIONAL NORTH COMMAND", "command", 790, 145, stock=9000, risk=22),
        Node("SC", "REGIONAL SOUTH COMMAND", "command", 820, 705, stock=8600, risk=28),
        Node("EC", "REGIONAL EAST COMMAND", "command", 1310, 360, stock=7600, risk=45),
        Node("WC", "REGIONAL WEST COMMAND", "command", 250, 610, stock=8300, risk=34),
        Node("NW", "NATIONAL WAREHOUSE", "warehouse", 330, 310, stock=28000, risk=8),
        Node("RW", "REGIONAL WAREHOUSE", "warehouse", 610, 255, stock=16500, risk=18),
        Node("FW", "FOOD WAREHOUSE", "warehouse", 468, 604, stock=12800, risk=31),
        Node("MW", "MEDICINE WAREHOUSE", "warehouse", 1045, 230, stock=7200, risk=41),
        Node("WW", "WATER WAREHOUSE", "warehouse", 1060, 585, stock=14800, risk=56),
        Node("FD", "FUEL DEPOT", "warehouse", 1410, 620, stock=11200, risk=47),
        Node("ES", "EMERGENCY SUPPLY DEPOT", "warehouse", 1330, 205, stock=9600, risk=52),
        Node("FOB", "FORWARD OPERATING BASE", "relief", 755, 500, stock=6400, risk=46),
        Node("CHK1", "DELTA CHECKPOINT", "checkpoint", 680, 392, risk=43),
        Node("CHK2", "EASTERN BRIDGE CHECKPOINT", "checkpoint", 1125, 430, risk=68),
    ]
    village_specs = [
        ("V01", "VARUNA EAST", 698, 237, 2780, 68, 74, 64, "flooded"),
        ("V02", "KALINGA EAST", 1024, 345, 5120, 92, 96, 89, "critical flood"),
        ("V03", "AMARA BASIN", 602, 603, 3260, 78, 83, 76, "waterlogged"),
        ("V04", "MAHANADI", 1185, 620, 2340, 62, 67, 54, "isolated"),
        ("V05", "RUDRA NORTH", 1275, 172, 3010, 82, 86, 92, "landslide"),
        ("V06", "SURYANAGAR", 1450, 465, 1960, 56, 61, 48, "stable"),
        ("V07", "NILA COAST", 1380, 735, 2420, 74, 79, 71, "cyclone"),
        ("V08", "ASHOKA RIDGE", 1115, 115, 1875, 67, 72, 81, "landslide"),
        ("V09", "CHANDRA PUR", 902, 248, 2190, 73, 80, 77, "storm"),
        ("V10", "KOSALA", 812, 338, 1680, 52, 58, 46, "stable"),
        ("V11", "JAGATI", 725, 700, 2940, 80, 84, 79, "flooded"),
        ("V12", "TARINI", 515, 756, 1320, 45, 51, 39, "stable"),
        ("V13", "RATNA", 390, 690, 2080, 61, 65, 58, "waterlogged"),
        ("V14", "BINDU WEST", 240, 485, 1740, 57, 62, 52, "storm"),
        ("V15", "SAMUDRA", 145, 382, 3540, 83, 88, 86, "flooded"),
        ("V16", "PRACHI", 406, 196, 1560, 49, 55, 44, "stable"),
        ("V17", "KAPILA", 575, 155, 2260, 66, 69, 63, "storm"),
        ("V18", "UTKAL NORTH", 650, 90, 1910, 70, 76, 82, "landslide"),
        ("V19", "DHAULI", 970, 730, 2830, 76, 82, 73, "flooded"),
        ("V20", "KONARK ROAD", 1180, 770, 1590, 58, 64, 59, "cyclone"),
        ("V21", "TAPASYA", 1520, 280, 1180, 42, 50, 66, "fire"),
        ("V22", "AGNI BLOCK", 1500, 145, 1370, 63, 70, 88, "fire"),
        ("V23", "BHARGAVI", 965, 505, 3200, 79, 87, 78, "flooded"),
        ("V24", "RUSHIKULYA", 1265, 525, 2540, 75, 79, 69, "cyclone"),
        ("V25", "SATYABADI", 335, 420, 2125, 59, 64, 55, "storm"),
        ("V26", "NARENDRAPUR", 190, 725, 1480, 53, 59, 49, "stable"),
        ("V27", "HIRAKUD LINE", 465, 100, 2680, 72, 81, 74, "earthquake"),
        ("V28", "GOPALPUR", 1375, 805, 2010, 69, 73, 70, "cyclone"),
        ("V29", "CHILIKA SOUTH", 930, 825, 2345, 77, 82, 84, "flooded"),
        ("V30", "BALARAMPUR", 1090, 650, 1775, 55, 63, 57, "stable"),
    ]
    for vid, name, x, y, pop, demand, priority, risk, status in village_specs:
        n = Node(vid, name, "village", x, y, pop, demand, priority, risk)
        item = asdict(n)
        item.update({
            "status": status,
            "food_need": round(demand * 1.25),
            "water_need": round(demand * 1.55),
            "medicine_need": round(demand * 0.62),
            "emergency_severity": max(risk, priority, demand),
        })
        nodes.append(item)

    # Convert dataclass command/warehouse nodes, then enrich logistics hubs with detailed inventory.
    nodes = [asdict(n) if isinstance(n, Node) else n for n in nodes]
    warehouse_profiles = {
        "HQ": (38000, 64000, 9300, 18000, 420, 2300, 1800, 760),
        "NW": (26000, 44000, 6200, 12000, 250, 1700, 1250, 520),
        "RW": (18000, 26000, 3900, 7500, 150, 980, 760, 410),
        "FW": (32000, 12000, 1200, 4200, 90, 640, 930, 260),
        "MW": (7200, 8000, 11800, 4300, 120, 2100, 480, 330),
        "WW": (9800, 62000, 1600, 5200, 160, 620, 1180, 290),
        "FD": (4200, 8800, 900, 38000, 260, 420, 540, 680),
        "ES": (14800, 16800, 3200, 9000, 310, 860, 2200, 820),
        "FOB": (7600, 11300, 1700, 6400, 110, 450, 620, 360),
    }
    for node in nodes:
        if node["id"] in warehouse_profiles:
            food, water, medicine, fuel, generators, kits, shelters, rescue = warehouse_profiles[node["id"]]
            node.update({"food": food, "water": water, "medicine": medicine, "fuel": fuel, "generators": generators, "medical_kits": kits, "shelter_units": shelters, "rescue_equipment": rescue})

    state_layout = {
        "HQ": (460, 1080, "Central District"), "CC": (1180, 1050, "Central District"), "NC": (1510, 380, "North District"),
        "SC": (1540, 1810, "South District"), "EC": (2540, 1090, "East District"), "WC": (390, 1340, "West District"),
        "NW": (720, 1010, "Central District"), "RW": (1180, 690, "River Basin District"), "FW": (660, 1550, "Industrial District"),
        "MW": (2050, 540, "Mountain District"), "WW": (2090, 1390, "River Basin District"), "FD": (2760, 1560, "Coastal District"),
        "ES": (2600, 600, "Forest District"), "FOB": (1560, 1190, "River Basin District"), "CHK1": (1390, 990, "River Basin District"),
        "CHK2": (2180, 1090, "East District"), "V01": (1370, 560, "North District"), "V02": (2140, 970, "East District"),
        "V03": (1080, 1460, "River Basin District"), "V04": (2280, 1540, "South District"), "V05": (2480, 360, "Mountain District"),
        "V06": (2840, 1160, "East District"), "V07": (2650, 1890, "Coastal District"), "V08": (2140, 260, "Mountain District"),
        "V09": (1710, 760, "River Basin District"), "V10": (1560, 910, "Central District"), "V11": (1420, 1740, "South District"),
        "V12": (910, 1870, "South District"), "V13": (610, 1700, "Industrial District"), "V14": (420, 1210, "West District"),
        "V15": (230, 1010, "West District"), "V16": (810, 640, "Central District"), "V17": (1090, 430, "North District"),
        "V18": (1320, 250, "North District"), "V19": (1870, 1810, "South District"), "V20": (2260, 1940, "Coastal District"),
        "V21": (2920, 590, "Forest District"), "V22": (2850, 300, "Forest District"), "V23": (1850, 1210, "River Basin District"),
        "V24": (2450, 1300, "East District"), "V25": (650, 1190, "Central District"), "V26": (320, 1760, "West District"),
        "V27": (950, 280, "Mountain District"), "V28": (2770, 2050, "Coastal District"), "V29": (1740, 2040, "Coastal District"),
        "V30": (2070, 1630, "South District"),
    }
    logistics_class = {
        "HQ": "National Command Center", "CC": "Emergency Operations Center", "NC": "Regional Command Center",
        "SC": "Regional Command Center", "EC": "District Command Center", "WC": "District Command Center",
        "NW": "National Warehouse", "RW": "Regional Warehouse", "FW": "Food Warehouse", "MW": "Medical Warehouse",
        "WW": "Water Warehouse", "FD": "Fuel Depot", "ES": "Emergency Stock Center", "FOB": "Forward Operating Base",
        "CHK1": "Bridge Checkpoint", "CHK2": "Bridge Checkpoint",
    }
    for node in nodes:
        x, y, district = state_layout.get(node["id"], (node["x"], node["y"], "Central District"))
        node.update({"x": x, "y": y, "district": district, "accessibility": max(18, 100 - node.get("risk", 0))})
        if node["id"] in logistics_class:
            node["category"] = logistics_class[node["id"]]

    road_pairs = [
        ("R-1", "HQ", "NW", 3, False, "highway", "open", "secure", "clear", "intact"),
        ("R-2", "HQ", "CC", 5, False, "highway", "open", "secure", "clear", "intact"),
        ("R-3", "NW", "RW", 4, False, "highway", "open", "secure", "clear", "intact"),
        ("R-4", "RW", "NC", 5, False, "highway", "open", "moderate", "clear", "intact"),
        ("R-5", "RW", "V09", 4, False, "district", "open", "moderate", "wet", "intact"),
        ("R-6", "V09", "V02", 5, False, "highway", "open", "high", "wet", "intact"),
        ("R-7", "V02", "EC", 6, False, "district", "open", "high", "wet", "intact"),
        ("R-8", "V02", "V05", 5, False, "district", "landslide watch", "critical", "clear", "intact"),
        ("R-9", "EC", "ES", 4, False, "highway", "open", "high", "clear", "intact"),
        ("R-10", "ES", "V22", 5, True, "district", "fire blockage", "critical", "clear", "intact"),
        ("R-11", "ES", "V21", 5, False, "district", "open", "high", "clear", "weak"),
        ("R-12", "CC", "FOB", 4, False, "highway", "open", "moderate", "clear", "intact"),
        ("R-13", "FOB", "V23", 4, False, "district", "open", "high", "flooded", "intact"),
        ("R-14", "V23", "WW", 3, False, "highway", "open", "high", "wet", "intact"),
        ("R-15", "WW", "V30", 4, False, "district", "open", "moderate", "wet", "intact"),
        ("R-16", "WW", "V24", 5, False, "district", "open", "high", "wet", "weak"),
        ("R-17", "V24", "FD", 4, False, "highway", "open", "moderate", "clear", "intact"),
        ("R-18", "FD", "V06", 5, False, "district", "open", "moderate", "clear", "intact"),
        ("R-19", "FD", "V28", 5, False, "district", "open", "high", "wet", "intact"),
        ("R-20", "SC", "V19", 5, False, "highway", "open", "high", "flooded", "intact"),
        ("R-21", "SC", "V29", 4, True, "district", "flooded road", "critical", "flooded", "intact"),
        ("R-22", "V29", "V20", 3, False, "district", "open", "high", "wet", "intact"),
        ("R-23", "V20", "V28", 4, False, "district", "open", "high", "wet", "weak"),
        ("R-24", "WC", "FW", 4, False, "highway", "open", "low", "clear", "intact"),
        ("R-25", "FW", "V13", 4, False, "district", "open", "moderate", "wet", "intact"),
        ("R-26", "V13", "V12", 4, False, "district", "open", "low", "clear", "intact"),
        ("R-27", "V13", "V03", 5, False, "district", "open", "high", "flooded", "intact"),
        ("R-28", "V03", "FOB", 4, False, "highway", "open", "high", "flooded", "intact"),
        ("R-29", "WC", "V14", 4, False, "district", "open", "moderate", "wet", "intact"),
        ("R-30", "V14", "V15", 5, False, "district", "open", "high", "flooded", "weak"),
        ("R-31", "V15", "HQ", 6, False, "highway", "open", "high", "wet", "intact"),
        ("R-32", "NW", "V16", 3, False, "district", "open", "low", "clear", "intact"),
        ("R-33", "V16", "V17", 3, False, "district", "open", "moderate", "clear", "intact"),
        ("R-34", "V17", "V18", 4, False, "district", "open", "high", "clear", "weak"),
        ("R-35", "V18", "NC", 3, True, "district", "collapsed bridge", "critical", "clear", "collapsed"),
        ("R-36", "V18", "V27", 4, False, "district", "open", "high", "clear", "weak"),
        ("R-37", "V27", "V01", 5, False, "district", "open", "high", "flooded", "intact"),
        ("R-38", "V01", "V09", 3, False, "highway", "open", "moderate", "wet", "intact"),
        ("R-39", "V01", "CHK1", 4, False, "district", "open", "moderate", "wet", "intact"),
        ("R-40", "CHK1", "FOB", 3, False, "highway", "open", "moderate", "clear", "intact"),
        ("R-41", "FOB", "CHK2", 5, False, "highway", "open", "high", "wet", "intact"),
        ("R-42", "CHK2", "EC", 4, False, "district", "open", "high", "wet", "weak"),
        ("R-43", "CHK2", "V04", 5, False, "district", "open", "moderate", "wet", "intact"),
        ("R-44", "V04", "V06", 5, False, "district", "open", "moderate", "clear", "intact"),
        ("R-45", "V07", "V28", 4, False, "district", "open", "high", "wet", "weak"),
        ("R-46", "V07", "FD", 6, False, "district", "open", "high", "wet", "intact"),
        ("R-47", "V08", "MW", 4, False, "district", "open", "high", "clear", "weak"),
        ("R-48", "MW", "V05", 5, False, "highway", "open", "critical", "clear", "intact"),
        ("R-49", "V10", "FOB", 3, False, "district", "open", "moderate", "clear", "intact"),
        ("R-50", "V11", "SC", 4, False, "district", "open", "high", "flooded", "intact"),
        ("R-51", "V11", "V03", 4, False, "district", "open", "high", "flooded", "intact"),
        ("R-52", "V25", "V14", 3, False, "district", "open", "moderate", "wet", "intact"),
        ("R-53", "V25", "NW", 4, False, "district", "open", "low", "clear", "intact"),
        ("R-54", "V26", "WC", 4, False, "district", "open", "moderate", "clear", "intact"),
    ]
    roads = []
    for rid, a, b, cost, blocked, road_type, condition, risk, flood_status, bridge_status in road_pairs:
        road = asdict(Road(rid, a, b, cost, blocked, road_type))
        road.update({
            "distance": cost * 3,
            "travel_cost": cost + (3 if risk == "high" else 6 if risk == "critical" else 0),
            "risk": risk,
            "condition": condition,
            "flood_status": flood_status,
            "bridge_status": bridge_status,
            "blockage_type": condition if blocked else "",
        })
        roads.append(road)
    for road in roads:
        rid_num = int(road["id"].split("-")[1])
        if road["road_type"] == "highway" and rid_num in {1, 2, 3, 6, 9, 14, 17, 20, 24, 28, 31, 38, 40, 41, 48}:
            road["road_type"] = "national"
            road["road_class"] = "National Highway"
        elif road["road_type"] == "highway":
            road["road_type"] = "state"
            road["road_class"] = "State Highway"
        elif road.get("risk") == "critical" or road.get("blocked"):
            road["road_type"] = "emergency"
            road["road_class"] = "Emergency Corridor"
        elif rid_num % 5 == 0:
            road["road_type"] = "village"
            road["road_class"] = "Village Road"
        else:
            road["road_class"] = "District Road"
    zones = [
        {"id": "FZ-03", "type": "flood", "name": "Varuna Flood Plain", "x": 1570, "y": 1280, "rx": 690, "ry": 330, "severity": 88, "affects": ["V01", "V02", "V03", "V11", "V23", "V29"]},
        {"id": "CZ-02", "type": "cyclone", "name": "Coastal Cyclone Belt", "x": 2410, "y": 1940, "rx": 620, "ry": 260, "severity": 74, "affects": ["V07", "V20", "V24", "V28"]},
        {"id": "FIRE-6", "type": "fire", "name": "Eastern Fire Line", "x": 2860, "y": 430, "rx": 260, "ry": 180, "severity": 82, "affects": ["V21", "V22"]},
        {"id": "LS-7", "type": "landslide", "name": "Northern Landslide Ridge", "x": 2050, "y": 300, "rx": 610, "ry": 220, "severity": 91, "affects": ["V05", "V08", "V18"]},
        {"id": "EQ-1", "type": "earthquake", "name": "Western Fault Tremor", "x": 920, "y": 300, "rx": 390, "ry": 160, "severity": 67, "affects": ["V17", "V27"]},
    ]
    return {
        "map": {
            "width": 3200,
            "height": 2300,
            "state_name": "Varuna Pradesh",
            "initial_view": {"x": 580, "y": 540, "zoom": 0.72},
            "districts": [
                {"name": "North District", "kind": "valley", "path": "M730 120L1560 80L1830 410L1620 690L900 680L590 390Z"},
                {"name": "Mountain District", "kind": "mountain", "path": "M1600 80L2430 90L2670 460L2290 730L1830 430Z"},
                {"name": "Forest District", "kind": "forest", "path": "M2460 130L3150 260L3090 980L2600 890L2290 730L2670 460Z"},
                {"name": "West District", "kind": "plain", "path": "M90 760L610 610L900 900L760 1500L280 1510L80 1150Z"},
                {"name": "Central District", "kind": "urban", "path": "M760 700L1510 680L1670 1080L1280 1330L760 1240L610 900Z"},
                {"name": "River Basin District", "kind": "basin", "path": "M1510 690L2260 780L2390 1430L1760 1580L1280 1340L1670 1080Z"},
                {"name": "East District", "kind": "plateau", "path": "M2260 780L3060 950L3000 1540L2380 1610L2390 1430Z"},
                {"name": "Industrial District", "kind": "industrial", "path": "M300 1510L790 1470L1080 1800L850 2180L190 2040Z"},
                {"name": "South District", "kind": "plain", "path": "M1080 1510L1810 1580L2060 2190L870 2210L1080 1800Z"},
                {"name": "Coastal District", "kind": "coastal", "path": "M2060 1620L3020 1560L3150 2220L2060 2220Z"},
            ],
            "rivers": [
                {"name": "Mahanadi Main Channel", "path": "M-80 1030C350 860 650 960 940 1050C1240 1145 1410 1240 1660 1185C2010 1110 2210 940 2550 1010C2860 1070 3030 1180 3300 1120"},
                {"name": "Varuna River", "path": "M1120 0C1210 320 1070 580 1320 840C1510 1040 1570 1240 1450 1580C1380 1780 1490 1990 1600 2340"},
                {"name": "Chilika Backwater", "path": "M1980 2140C2270 1980 2580 1980 3200 2110"},
            ],
            "lakes": [
                {"name": "North Reservoir", "x": 1190, "y": 510, "rx": 165, "ry": 64},
                {"name": "Chilika Relief Lagoon", "x": 2460, "y": 2050, "rx": 360, "ry": 115},
                {"name": "West Storage Lake", "x": 450, "y": 1660, "rx": 150, "ry": 72},
            ],
        },
        "nodes": nodes,
        "roads": roads,
        "zones": zones,
        "vehicles": [asdict(v) for v in [
            Vehicle("TR-14", "TRUCK", "HQ", 1100, 84, 44, 180),
            Vehicle("HT-31", "HEAVY TRUCK", "NW", 2400, 76, 34, 220),
            Vehicle("AM-04", "AMBULANCE", "MW", 260, 88, 70, 180),
            Vehicle("HL-02", "HELICOPTER", "CC", 420, 71, 96, 260),
            Vehicle("BT-09", "BOAT", "FOB", 760, 63, 28, 120, "EN ROUTE"),
            Vehicle("DR-17", "DRONE", "EC", 45, 92, 110, 80),
            Vehicle("SV-22", "SUPPLY VAN", "FW", 650, 81, 58, 160),
            Vehicle("MT-08", "MILITARY TRANSPORT", "HQ", 1800, 69, 52, 300),
        ]],
        "resources": {"food": 128000, "water": 185000, "medicine": 31800, "fuel": 91000, "medical_kits": 10320, "generators": 1900, "shelters": 9560, "rescue_equipment": 3880},
        "served": 9,
        "delivered": 38,
        "timeline": [
            ["06:28", "DISPATCH", "BT-09 departed Delta Relief"],
            ["06:31", "ALERT", "R-35 northern bridge collapse confirmed"],
            ["06:36", "DELIVERY", "TR-14 delivered water to Varuna"],
            ["06:39", "REPLAN", "A* recalculated eastern corridor"],
            ["06:45", "FLOOD", "FZ-03 expanded into Varuna flood plain"],
            ["06:52", "COMMAND", "Regional East Command escalated cyclone corridor"],
        ],
        "alerts": [
            ["critical", "LANDSLIDE WATCH", "R-8 corridor open under escort-only restriction"],
            ["critical", "BRIDGE COLLAPSE", "R-35 northern bridge unavailable"],
            ["medium", "MEDICINE RISK", "Kalinga stock threshold in 5.1h"],
            ["medium", "FUEL WATCH", "BT-09 reserve below 65%"],
        ],
    }


def scenario_from_request() -> dict:
    payload = request.get_json(silent=True) or {}
    scenario = payload.get("scenario") or default_scenario()
    return scenario


def node_map(scenario: dict) -> Dict[str, dict]:
    return {node["id"]: node for node in scenario["nodes"]}


def passable_roads(scenario: dict) -> Iterable[dict]:
    return (road for road in scenario["roads"] if not road.get("blocked"))


def neighbors(scenario: dict, node_id: str) -> List[Tuple[str, int, str]]:
    out = []
    for road in passable_roads(scenario):
        if road["a"] == node_id:
            out.append((road["b"], road.get("travel_cost", road["cost"]), road["id"]))
        elif road["b"] == node_id:
            out.append((road["a"], road.get("travel_cost", road["cost"]), road["id"]))
    return out


def distance(scenario: dict, a: str, b: str) -> float:
    nodes = node_map(scenario)
    if a not in nodes or b not in nodes:
        return 999.0
    na, nb = nodes[a], nodes[b]
    return hypot(na["x"] - nb["x"], na["y"] - nb["y"]) / 100


def reconstruct(parent: Dict[str, Optional[str]], goal: str) -> List[str]:
    if goal not in parent:
        return []
    path, cursor = [], goal
    while cursor is not None:
        path.insert(0, cursor)
        cursor = parent[cursor]
    return path


def path_cost(scenario: dict, path: List[str]) -> int:
    cost = 0
    for a, b in zip(path, path[1:]):
        for road in scenario["roads"]:
            if {road["a"], road["b"]} == {a, b}:
                cost += road["cost"]
                break
    return cost


def search_algorithm(scenario: dict, algorithm: str, start: str, goal: str, depth_limit: int = 4) -> dict:
    if algorithm == "IDS":
        merged_steps = []
        began = perf_counter()
        for limit in range(0, 10):
            result = search_algorithm(scenario, "DLS", start, goal, limit)
            for step in result["steps"]:
                step["explanation"] = f"IDS pass at depth limit {limit}: {step['explanation']}"
            merged_steps.extend(result["steps"])
            if result["path"]:
                result["algorithm"] = "IDS"
                result["steps"] = merged_steps
                result["execution_time_ms"] = round((perf_counter() - began) * 1000, 3)
                return result
        return {"algorithm": "IDS", "path": [], "cost": 0, "steps": merged_steps, "expanded": 0, "memory": 0, "execution_time_ms": 0, "quality": 0}

    began = perf_counter()
    parent: Dict[str, Optional[str]] = {start: None}
    costs = {start: 0}
    visited, expanded, steps = set(), [], []
    max_memory = 1

    if algorithm in {"UCS", "Greedy", "A*"}:
        frontier = []
        heappush(frontier, (0, start, 0))
    else:
        frontier = deque([(start, 0, 0)])

    def frontier_ids() -> List[str]:
        if algorithm in {"UCS", "Greedy", "A*"}:
            return [item[1] for item in frontier]
        return [item[0] for item in frontier]

    while frontier:
        if algorithm in {"UCS", "Greedy", "A*"}:
            _, current, depth = heappop(frontier)
        elif algorithm in {"DFS", "DLS"}:
            current, _, depth = frontier.pop()
        else:
            current, _, depth = frontier.popleft()

        if current in visited:
            continue

        visited.add(current)
        expanded.append(current)
        candidate_nodes = [n for n, _, _ in neighbors(scenario, current)]
        should_expand = current != goal and not (algorithm == "DLS" and depth >= depth_limit)
        items = neighbors(scenario, current)
        if algorithm in {"DFS", "DLS"}:
            items = list(reversed(items))

        if should_expand:
            for nxt, road_cost, _ in items:
                new_cost = costs[current] + road_cost
                if nxt in visited:
                    continue
                if algorithm in {"BFS", "DFS", "DLS"} and nxt not in parent:
                    parent[nxt] = current
                    costs[nxt] = new_cost
                    frontier.append((nxt, new_cost, depth + 1))
                elif algorithm in {"UCS", "Greedy", "A*"} and new_cost < costs.get(nxt, float("inf")):
                    parent[nxt] = current
                    costs[nxt] = new_cost
                    priority = new_cost
                    if algorithm == "Greedy":
                        priority = distance(scenario, nxt, goal)
                    elif algorithm == "A*":
                        priority = new_cost + distance(scenario, nxt, goal)
                    heappush(frontier, (priority, nxt, depth + 1))
        max_memory = max(max_memory, len(frontier) + len(visited))
        steps.append({
            "current": current,
            "visited": list(visited),
            "expanded": list(expanded),
            "frontier": frontier_ids(),
            "open_list": frontier_ids() if algorithm in {"UCS", "Greedy", "A*"} else [],
            "closed_list": list(visited),
            "queue": frontier_ids() if algorithm == "BFS" else [],
            "stack": frontier_ids() if algorithm in {"DFS", "DLS"} else [],
            "candidates": candidate_nodes,
            "path": reconstruct(parent, current),
            "cost": costs.get(current, 0),
            "g": costs.get(current, 0),
            "h": round(distance(scenario, current, goal), 3),
            "f": round(costs.get(current, 0) + distance(scenario, current, goal), 3),
            "explanation": explain_step(algorithm, current, goal, costs.get(current, 0), len(frontier)),
        })

        if current == goal:
            break

    final_path = reconstruct(parent, goal)
    final_cost = path_cost(scenario, final_path)
    quality = max(0, min(100, round(100 / (1 + max(0, final_cost - 13) / 8)))) if final_path else 0
    return {
        "algorithm": algorithm,
        "path": final_path,
        "cost": final_cost,
        "path_length": max(0, len(final_path) - 1),
        "steps": steps,
        "expanded": len(expanded),
        "memory": max_memory,
        "execution_time_ms": round((perf_counter() - began) * 1000, 3),
        "quality": quality,
        "success": bool(final_path),
    }


def explain_step(algorithm: str, current: str, goal: str, cost: int, frontier_size: int) -> str:
    if algorithm == "BFS":
        return f"BFS expands {current} because it is earliest in the queue; frontier size is {frontier_size}."
    if algorithm == "DFS":
        return f"DFS dives into {current}, following the newest branch before backtracking."
    if algorithm == "DLS":
        return f"DLS evaluates {current} within the active depth boundary."
    if algorithm == "UCS":
        return f"UCS selects {current} because its cumulative cost is {cost}."
    if algorithm == "Greedy":
        return f"Greedy selects {current} based on estimated proximity to {goal}."
    if algorithm == "A*":
        return f"A* selects {current} by balancing travelled cost {cost} with estimated distance to {goal}."
    return f"{algorithm} expands {current}."


def evaluate_constraints(scenario: dict, decision: Optional[dict] = None) -> List[dict]:
    decision = decision or make_decision(scenario)
    target = decision["selected_village"]
    vehicle = decision["selected_vehicle"]
    route = decision["selected_route"]
    warehouse = decision["selected_warehouse"]
    demand_units = target["demand"] * 10
    resources = scenario["resources"]
    blocked_route_roads = [road for road in scenario["roads"] if road.get("blocked")]
    checks = [
        ("Vehicle Capacity", vehicle["capacity"] >= demand_units, "HIGH", f"{vehicle['id']} capacity {vehicle['capacity']}kg vs required {demand_units}kg", "Overload risk delays dispatch and damages vehicle readiness."),
        ("Fuel Availability", vehicle["fuel"] >= 35 and vehicle["range_km"] >= route["cost"] * 3, "HIGH", f"{vehicle['id']} fuel {vehicle['fuel']}%, range {vehicle['range_km']}km, route {route['cost'] * 3}km", "Low fuel can strand relief cargo before arrival."),
        ("Warehouse Stock", warehouse.get("water", 0) >= demand_units and warehouse.get("medicine", 0) >= target["demand"] * 2, "CRITICAL", f"{warehouse['name']} water {warehouse.get('water', 0)}L, medicine {warehouse.get('medicine', 0)} units", "Shortage forces partial allocation or alternate warehouse sourcing."),
        ("Road Blockages", bool(route["path"]), "CRITICAL", "A navigable route exists" if route["path"] else "No route avoids blocked roads", "Blocked corridors force rerouting and increase response time."),
        ("Road Condition", len(blocked_route_roads) < 6, "HIGH", f"{len(blocked_route_roads)} damaged corridors currently marked blocked", "Multiple failures lower route resilience and increase replan frequency."),
        ("Delivery Limits", scenario.get("served", 0) < len([n for n in scenario["nodes"] if n["type"] == "village"]), "MEDIUM", f"{scenario.get('served', 0)} settlements already served", "Mission capacity is reduced as daily delivery limits are consumed."),
        ("Time Constraints", route["cost"] * 3 <= 90, "MEDIUM", f"Estimated arrival {route['cost'] * 3} minutes", "Late arrival increases exposure for critical villages."),
        ("Priority Constraints", target["priority"] >= 60, "LOW", f"{target['name']} priority index {target['priority']}", "Low priority targets should not displace critical settlements."),
    ]
    return [{"name": n, "satisfied": ok, "severity": sev, "reason": reason, "impact": impact} for n, ok, sev, reason, impact in checks]


def make_decision(scenario: dict) -> dict:
    villages = [n for n in scenario["nodes"] if n["type"] == "village"]
    vehicles = [v for v in scenario["vehicles"] if v.get("status") != "FAILED"]
    warehouses = [n for n in scenario["nodes"] if n["type"] in {"warehouse", "command", "relief"}]
    ranked = []
    for village in villages:
        route = search_algorithm(scenario, "A*", "HQ", village["id"])
        accessibility = 100 if route["path"] else 0
        distance_penalty = route["cost"] * 2.1 if route["path"] else 80
        stock_support = min(100, scenario["resources"]["water"] / max(1, village["demand"] * 10) * 45)
        fuel_cost = route["cost"] * 1.7
        zone_severity = max((z["severity"] for z in scenario.get("zones", []) if village["id"] in z.get("affects", [])), default=0)
        blocked_penalty = 18 if not route["path"] else 0
        constraint_penalty = 10 if route["cost"] * 3 > 90 else 0
        score = (
            village["population"] / 90
            + village["demand"] * 0.75
            + village["risk"] * 0.95
            + village["priority"] * 0.82
            + zone_severity * 0.46
            + accessibility * 0.35
            + stock_support * 0.25
            - distance_penalty
            - fuel_cost
            - blocked_penalty
            - constraint_penalty
        )
        ranked.append({
            "id": village["id"],
            "name": village["name"],
            "score": round(score, 2),
            "breakdown": {
                "population": round(village["population"] / 90, 2),
                "demand": round(village["demand"] * 0.75, 2),
                "hazard": round(village["risk"] * 0.95, 2),
                "zone_severity": round(zone_severity * 0.46, 2),
                "priority": round(village["priority"] * 0.82, 2),
                "accessibility": round(accessibility * 0.35, 2),
                "resource_support": round(stock_support * 0.25, 2),
                "distance_penalty": round(-distance_penalty, 2),
                "fuel_cost": round(-fuel_cost, 2),
                "constraint_penalty": round(-(blocked_penalty + constraint_penalty), 2),
            },
            "route": route,
        })
    ranked.sort(key=lambda item: item["score"], reverse=True)
    selected = ranked[0]
    selected_village = next(n for n in villages if n["id"] == selected["id"])
    selected_route = selected["route"]
    selected_vehicle = sorted(vehicles, key=lambda v: (v["capacity"] * 0.55 + v["fuel"] * 5 + v["speed"] * 2), reverse=True)[0]
    selected_warehouse = sorted(
        warehouses,
        key=lambda w: (w.get("water", 0) + w.get("food", 0) + w.get("medicine", 0) * 3) - distance(scenario, w["id"], selected_village["id"]) * 900,
        reverse=True,
    )[0]
    alternatives = [{
        "name": item["name"],
        "score": item["score"],
        "rejected_reason": "Lower combined urgency, access, and resource-support score than the selected target."
    } for item in ranked[1:]]
    return {
        "selected_village": selected_village,
        "selected_route": selected_route,
        "selected_vehicle": selected_vehicle,
        "selected_warehouse": selected_warehouse,
        "selected_algorithm": "A*",
        "ranked_villages": ranked,
        "alternatives": alternatives,
        "reasoning": [
            f"{selected_village['name']} has the highest combined score: population {selected_village['population']}, demand {selected_village['demand']}, hazard {selected_village['risk']}, priority {selected_village['priority']}.",
            f"A* selected route {' -> '.join(selected_route['path'])} with cost {selected_route['cost']} because it avoids blocked corridors and minimizes weighted travel.",
            f"{selected_vehicle['id']} was selected because capacity, fuel, speed, and readiness best match the target demand.",
            f"{selected_warehouse['name']} was selected because available stock and distance beat alternate warehouses.",
        ],
        "agent_cycle": {
            "observe": "Villages, roads, blocked corridors, vehicle readiness, warehouse stock, demand, and hazard severity.",
            "analyze": "Run search, evaluate constraints, estimate shortage risk, and score village urgency.",
            "decide": "Select target village, route, vehicle, and allocation strategy.",
            "act": "Dispatch vehicle, update route trace, consume inventory, and record mission events.",
            "monitor": "Track delivery progress, stock depletion, route failures, and changing hazard zones.",
            "replan": "Re-run A*, CSP checks, and decision ranking whenever roads, resources, hazards, or population change.",
        },
    }


def forecast(scenario: dict) -> dict:
    total_demand = sum(n["demand"] for n in scenario["nodes"] if n["type"] == "village")
    resources = scenario["resources"]
    return {
        "food": risk_line(resources["food"], total_demand * 70, "kg"),
        "water": risk_line(resources["water"], total_demand * 95, "L"),
        "medicine": risk_line(resources["medicine"], total_demand * 18, "units"),
        "fuel": risk_line(resources["fuel"], total_demand * 16, "L"),
        "medical_kits": risk_line(resources["medical_kits"], total_demand * 5, "kits"),
        "generators": risk_line(resources["generators"], total_demand * 1, "units"),
        "shelters": risk_line(resources["shelters"], total_demand * 4, "units"),
        "rescue_equipment": risk_line(resources["rescue_equipment"], total_demand * 2, "sets"),
    }


def risk_line(current: int, projected: int, unit: str) -> dict:
    ratio = current / max(1, projected)
    level = "LOW" if ratio > 0.65 else "MEDIUM" if ratio > 0.35 else "CRITICAL"
    return {"current": current, "projected_need": projected, "unit": unit, "risk": level, "coverage": round(min(100, ratio * 100), 1)}


def route_summary(scenario: dict, path: List[str]) -> dict:
    roads = []
    for a, b in zip(path, path[1:]):
        road = next((r for r in scenario["roads"] if {r["a"], r["b"]} == {a, b}), None)
        if road:
            roads.append(road)
    distance_km = sum(r.get("distance", r["cost"] * 3) for r in roads)
    travel_cost = sum(r.get("travel_cost", r["cost"]) for r in roads)
    risk_weights = {"secure": 4, "low": 8, "moderate": 18, "high": 32, "critical": 48}
    risk_score = round(sum(risk_weights.get(r.get("risk", "low"), 14) for r in roads) / max(1, len(roads)))
    flood_impact = "FLOODED SEGMENTS" if any(r.get("flood_status") == "flooded" for r in roads) else "WET CORRIDOR" if any(r.get("flood_status") == "wet" for r in roads) else "CLEAR"
    bridge_status = "COLLAPSED" if any(r.get("bridge_status") == "collapsed" for r in roads) else "WEAK BRIDGE" if any(r.get("bridge_status") == "weak" for r in roads) else "INTACT"
    return {
        "distance": distance_km,
        "travel_cost": travel_cost,
        "time": round(distance_km * 2.1 + risk_score * 0.35),
        "risk_score": risk_score,
        "flood_impact": flood_impact,
        "bridge_status": bridge_status,
        "blocked": len([r for r in roads if r.get("blocked")]),
        "road_classes": sorted({r.get("road_class", r.get("road_type", "Road")) for r in roads}),
    }


def recommend_vehicle(scenario: dict, target: dict, summary: dict, selected_vehicle_id: Optional[str] = None) -> dict:
    ranked = []
    demand_units = target.get("demand", 0) * 10
    for vehicle in scenario["vehicles"]:
        if vehicle.get("status") == "FAILED":
            score = -999
            reasons = ["Rejected: vehicle is marked FAILED."]
        else:
            score = vehicle["capacity"] * 0.035 + vehicle["fuel"] * 0.55 + vehicle["speed"] * 0.22 + vehicle["range_km"] * 0.08
            reasons = [
                f"Capacity {vehicle['capacity']}kg against estimated demand {demand_units}kg.",
                f"Fuel {vehicle['fuel']}% and range {vehicle['range_km']}km against route {summary['distance']}km.",
            ]
            if vehicle["capacity"] < demand_units:
                score -= 22
                reasons.append("Capacity is below full demand, so dispatch may require partial load or relay support.")
            if vehicle["range_km"] < summary["distance"]:
                score -= 35
                reasons.append("Range is below route distance, creating refuel risk.")
            if summary["flood_impact"] != "CLEAR" and vehicle["type"] in {"BOAT", "HELICOPTER"}:
                score += 30
                reasons.append("Flood corridor favors aerial or water-capable asset.")
            if summary["bridge_status"] != "INTACT" and vehicle["type"] in {"HELICOPTER", "DRONE"}:
                score += 24
                reasons.append("Weak bridge risk favors bridge-independent movement.")
            if vehicle["type"] in {"HEAVY TRUCK", "MILITARY TRANSPORT"} and summary["bridge_status"] == "WEAK BRIDGE":
                score -= 18
                reasons.append("Heavy asset is penalized on weak-bridge corridors.")
            if selected_vehicle_id and vehicle["id"] == selected_vehicle_id:
                score += 4
                reasons.append("Planner-selected asset receives a small preference for operator intent.")
        ranked.append({"id": vehicle["id"], "type": vehicle["type"], "score": round(score, 2), "reasons": reasons})
    ranked.sort(key=lambda item: item["score"], reverse=True)
    return {"selected": ranked[0], "ranked": ranked}


def choose_supply_chain(scenario: dict, target: dict) -> dict:
    candidates = [n for n in scenario["nodes"] if n["type"] in {"warehouse", "command", "relief"}]
    ranked = sorted(
        candidates,
        key=lambda w: (w.get("food", 0) + w.get("water", 0) + w.get("medicine", 0) * 3 + w.get("fuel", 0) * 0.4) - distance(scenario, w["id"], target["id"]) * 850,
        reverse=True,
    )
    warehouse = ranked[0]
    command = sorted([n for n in scenario["nodes"] if n["type"] == "command"], key=lambda c: distance(scenario, c["id"], target["id"]))[0]
    return {
        "warehouse": warehouse,
        "command_center": command,
        "reasoning": [
            f"{warehouse['name']} has the strongest stock-to-distance score for {target['name']}.",
            f"{command['name']} is the closest command authority for coordination and route escalation.",
        ],
    }


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/scenario")
def api_scenario():
    scenario = default_scenario()
    decision = make_decision(scenario)
    return jsonify({
        "scenario": scenario,
        "decision": decision,
        "constraints": evaluate_constraints(scenario, decision),
        "forecast": forecast(scenario),
        "algorithms": ALGORITHM_INFO,
    })


@app.post("/api/search")
def api_search():
    data = request.get_json(silent=True) or {}
    scenario = data.get("scenario") or default_scenario()
    return jsonify(search_algorithm(
        scenario,
        data.get("algorithm", "A*"),
        data.get("start", "HQ"),
        data.get("goal", "V02"),
        int(data.get("depth_limit", 4)),
    ))


@app.post("/api/route-plan")
def api_route_plan():
    data = request.get_json(silent=True) or {}
    scenario = data.get("scenario") or default_scenario()
    start = data.get("start", "HQ")
    goal = data.get("goal", "V02")
    algorithm = data.get("algorithm", "A*")
    result = search_algorithm(scenario, algorithm, start, goal, int(data.get("depth_limit", 4)))
    nodes = node_map(scenario)
    target = nodes.get(goal) or make_decision(scenario)["selected_village"]
    summary = route_summary(scenario, result.get("path", []))
    vehicle = recommend_vehicle(scenario, target, summary, data.get("vehicle"))
    supply = choose_supply_chain(scenario, target)
    return jsonify({
        "route": result,
        "summary": summary,
        "vehicle_recommendation": vehicle,
        "supply_chain": supply,
        "explanation": [
            f"{algorithm} produced {' -> '.join(result.get('path', [])) or 'no feasible route'} from {start} to {goal}.",
            f"Route risk is {summary['risk_score']} with {summary['flood_impact'].lower()} and bridge status {summary['bridge_status'].lower()}.",
            f"{vehicle['selected']['id']} is recommended because it has the strongest route-fit score under current constraints.",
        ],
    })


@app.post("/api/decision")
def api_decision():
    scenario = scenario_from_request()
    decision = make_decision(scenario)
    return jsonify({
        "decision": decision,
        "constraints": evaluate_constraints(scenario, decision),
        "forecast": forecast(scenario),
    })


@app.post("/api/compare")
def api_compare():
    data = request.get_json(silent=True) or {}
    scenario = data.get("scenario") or default_scenario()
    start = data.get("start", "HQ")
    goal = data.get("goal")
    if not goal or goal not in node_map(scenario):
        goal = make_decision(scenario)["selected_village"]["id"]
    rows = []
    for algorithm in ALGORITHM_INFO:
        result = search_algorithm(scenario, algorithm, start, goal)
        rows.append({
            "algorithm": algorithm,
            "path_length": result.get("path_length", 0),
            "cost": result.get("cost", 0),
            "time": result.get("execution_time_ms", 0),
            "memory": result.get("memory", 0),
            "expanded": result.get("expanded", 0),
            "success_rate": 100 if result.get("success") else 0,
            "quality": result.get("quality", 0),
        })
    return jsonify({"rows": rows})


if __name__ == "__main__":
    app.run(debug=True)
