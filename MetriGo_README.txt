MetriGo — Smart Metro Booking System

MetriGo is a full-stack metro ticket booking web application that
simulates a real-world transit system. It combines efficient backend
algorithms (DAA concepts) with a modern interactive frontend to deliver
smart routing, booking, and pricing.

------------------------------------------------------------------------

TECH STACK

Frontend: - HTML, CSS, JavaScript (Vanilla)

Backend: - Node.js + Express

Storage: - JSON-based file storage

Authentication: - express-session - bcrypt (password hashing)

------------------------------------------------------------------------

FEATURES

-   User Authentication (Login/Register)
-   Smart Booking System with PNR generation
-   Shortest Path Calculation between stations
-   Multi-seat selection & allocation
-   Smart Seat Suggestion (AI-like behavior)
-   Dynamic Pricing based on time slots
-   Time Slot Selection with peak/off-peak logic
-   Crowd Level Simulation
-   Fast user lookup using hashing

------------------------------------------------------------------------

DAA CONCEPTS USED

1.  DIJKSTRA’S ALGORITHM

Where Used: - Backend C module (dijkstra.c) - /shortest-path API

Purpose: - Find the shortest path between two metro stations

Why Used: - Metro network is modeled as a graph - Guarantees optimal
shortest route

Complexity: - Time: O((V + E) log V) - Space: O(V)

------------------------------------------------------------------------

2.  GREEDY ALGORITHM

Where Used: - Seat allocation system

Purpose: - Quickly assign seats based on availability

Logic: - Prefer same row - Assign nearest available seats

Why Used: - Fast real-time decision making

Complexity: - O(n)

------------------------------------------------------------------------

3.  BACKTRACKING ALGORITHM

Where Used: - Smart Seat Suggestion system (/suggest-seats)

Purpose: - Explore all possible seat combinations - Suggest best
grouping

Logic: - Generate combinations - Score based on: - Same row -
Adjacency - Minimal spread

Why Used: - Provides optimal solution when greedy fails

Optimization: - Early pruning - Skipped for large inputs

------------------------------------------------------------------------

4.  HASHING

Where Used: - User lookup (buildUserMap) - PNR generation (SHA-256) -
Seat tracking using Set

Purpose: - Fast data retrieval

Why Used: - Reduces lookup time from O(n) to O(1)

------------------------------------------------------------------------

5.  DYNAMIC PRICING

Where Used: - Booking system (applyPeakPricing)

Purpose: - Adjust fare based on time slots

Logic: - Peak hours → higher fare - Off-peak → lower fare

Why Used: - Simulates real-world metro pricing

------------------------------------------------------------------------

6.  GRAPH DATA STRUCTURE

Where Used: - Metro network representation

Structure: - Stations = Nodes - Connections = Edges

Why Used: - Enables pathfinding algorithms like Dijkstra

------------------------------------------------------------------------

API ENDPOINTS

AUTHENTICATION - POST /register → Register user - POST /login → Login
user - GET /logout → Logout

PROFILE - GET /profile → Get user details - POST /update-profile →
Update profile/password

METRO & ROUTING - GET /stations → Fetch stations - POST /shortest-path →
Get route (Dijkstra)

BOOKING - POST /save-booking → Create booking - GET /my-bookings → User
bookings - GET /check-pnr → Check booking status

SMART SEAT SYSTEM - POST /suggest-seats → Seat suggestions (Greedy +
Backtracking)

SMART CARD - GET /card-balance → Check balance - POST /recharge-card →
Recharge

------------------------------------------------------------------------

SYSTEM DESIGN HIGHLIGHTS

-   Hybrid algorithm approach (Greedy + Backtracking)
-   Secure authentication with hashing
-   Modular backend structure
-   Intelligent UX (suggestions, pricing, crowd simulation)
-   File-based database

------------------------------------------------------------------------

COMPLEXITY OVERVIEW

Shortest Path: O((V+E) log V) Seat Allocation: O(n) Seat Suggestion:
O(n^k) (optimized) User Lookup: O(1)

------------------------------------------------------------------------

LIMITATIONS

-   Uses JSON instead of database
-   No real-time seat locking
-   No email system for password reset

------------------------------------------------------------------------

FUTURE IMPROVEMENTS

-   Real-time seat sync
-   Database integration
-   AI-based crowd prediction
-   Live metro tracking
-   Payment gateway integration

------------------------------------------------------------------------

CONCLUSION

MetriGo demonstrates how classical DAA concepts can be applied to build
a real-world intelligent system. It bridges theory and practical
software engineering.

Built with logic, not just code.
