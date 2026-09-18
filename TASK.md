FE Evaluation : Audit Workflow Challenge
👨🏻‍💻
Deadline: 19 September, 2026 10:00 AM
Expected time: 6–10 hours
Please do not spend more than 2 days on this task.
About the Task
OBLIQ-in is exploring an audit workflow platform for small and mid-sized CA firms.
For a CA firm, audit work involves collecting documents from clients, checking them, requesting corrections, assigning work to team members, reviewing the work, and maintaining a proper history of what happened.
Today, much of this work can be scattered across:
🧩
WhatsApp + Excel + Email + Google Drive + Manual Follow-ups
Your task is to build a small working prototype that solves one part of this problem.
You are not expected to build a complete audit platform.
We are evaluating your:
Problem-solving ability
Product thinking
Backend/system design
Security awareness
Ability to build a working feature
Code quality
Ability to explain technical decisions

Your Objective
Build a Mini Audit Document Review System.
The system should allow a CA firm employee to:
<aside>
🎯
Create/View a Client → Add Audit Documents → Review Documents → Approve or Request Correction → View Audit History
</aside>
That is the complete scope. Do not build unrelated features.

Required Workflow
Step 1 — Client
Create or select a client.
Example: ABC Traders Pvt. Ltd.
Step 2 — Documents
For the client, maintain a small list of required audit documents.
Examples:
* Bank Statement
* Sales Register
* Purchase Register
* GST Return
* Expense Summary
Each document should have a status.
Suggested status flow:
Pending → Uploaded → Under Review → Approved
or
Correction Required → Uploaded Again
You may use a different status design if you think it is better.

Main Feature — Document Review
A reviewer should be able to open a document and see:
* Document name
* Client
* Uploaded by
* Upload date/time
* Current status
* Review comment
The reviewer should be able to choose:
* Approve
* Request Correction
If correction is requested, a comment should be added.
“Page 3 is missing. Please upload the complete bank statement.”
The document should then move to Correction Required.

Audit History
<aside>
⭐
This is the most important part of the task.
</aside>
Every important action should generate an audit event.
Example:
10:20 AM
Rohit uploaded Bank_Statement.pdf

10:31 AM
Aman started reviewing Bank_Statement.pdf

10:34 AM
Aman requested correction

Reason:
Page 3 was missing

11:05 AM
Rohit uploaded revised document

11:12 AM
Aman approved Bank_Statement.pdf
The history should clearly show:
* Who performed the action
* What action happened
* When it happened
* Which document it affected
* Any relevant comment/reason
The audit history should not be freely editable by normal users.

Roles
Staff
Can:
* View assigned clients
* Upload documents
* View document status
* Respond to correction requests
Reviewer
Can:
* View documents
* Review documents
* Approve documents
* Request corrections
* View audit history
You may add a Partner/Admin role, but it is optional.

Basic Security Requirement
Assume OBLIQ-in will eventually be used by multiple CA firms.
For this evaluation, create at least two firms:
* Firm A: ABC & Co.
* Firm B: XYZ & Co.
A user from Firm A must not be able to access Firm B’s client or document data. Show how your backend prevents this.
You do not need to build enterprise-grade security. We want to see whether you understand:
<aside>
🔐
Authentication ≠ Authorization
Frontend hiding a button ≠ Security
</aside>
Explain briefly how your implementation handles tenant/firm isolation.

# Technology

You may use any stack you are comfortable with.

| Layer | Examples |
| --- | --- |
| Frontend | React, Next.js, Vue |
| Backend | Node.js, Express, FastAPI, Django, Java, Go |
| Database | PostgreSQL, MongoDB, SQLite |

You may use a simpler stack if it helps you finish the task properly. Do not choose a complicated architecture just to make the project look impressive.

AI Usage
AI tools are allowed. You may use:
* ChatGPT
* Claude
* Gemini
* Cursor
* GitHub Copilot
* Other AI tools
But you must disclose your AI usage. At the end of the README, add:
AI Tools Used:
ChatGPT:
Claude:
Gemini:
Cursor:
GitHub Copilot:

How AI was used:
We care about whether you understand and can explain your implementation.

What You Do Not Need to Build
Do not spend your time building:
* WhatsApp integration
* GST filing
* Tax calculation
* Government portal automation
* OCR
* Advanced AI agents
* Mobile application
* Payment system
* Complex analytics dashboard
* Production-level authentication
* Cloud-scale architecture
These are outside the scope of this evaluation.
<aside>
✅
A small working product is better than a large unfinished product.
</aside>


Submission Requirements
1. GitHub Repository
Your repository should contain:
* Source code
* README
* Setup instructions
* Environment/setup details
* Screenshots
2. Working Demo
Provide either:
* A live deployed link, or
* Clear instructions to run the project locally
A live demo is preferred but not mandatory.
3. Short Demo Video (optional but useful)
Record a 3–5 minute video showing:
1. Login / role
2. Client
3. Upload/add document
4. Review document
5. Request correction or approve
6. Audit history
7. Brief explanation of your architecture
Do not spend time making a highly edited video. A screen recording is enough.
4. Short Architecture Explanation (optional but useful)
Add a simple diagram showing:
Frontend
   ↓
Backend/API
   ↓
Database
   ↓
Audit Log
Also explain: How does Firm A stay isolated from Firm B?
Maximum 500 words.

Evaluation Criteria
Category
Marks
Working Core Workflow
25
Audit Trail / Traceability
20
Backend / Data Design
15
Security / Tenant Isolation
15
Code Quality
10
UI / Usability
5
Architecture Explanation
5
Product Judgement
5
Total
100


What We Will Look For
We are not looking for the most complex solution.
We will look for whether you:
* Understood the workflow
* Kept the scope under control
* Built something that actually works
* Designed sensible data models
* Thought about access control
* Created a meaningful audit trail
* Handled correction/review properly
* Can explain your own code
One Important Question
At the end of your README, answer:
“What would you improve if you had one more week?”
Maximum 300 words.
We are interested in your ability to identify the next most valuable improvement rather than adding random features.

*Note
This is an evaluation prototype, not a production system.
You do not need to solve the entire CA/audit industry.
Focus on one thing:
<aside>
🚀
Can you build a simple audit workflow where documents move through review and correction while every important action is traceable?
</aside>
Keep the scope small.
Make it work.
Explain your decisions.
Good luck.


