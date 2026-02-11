
import { describe, it, expect } from "bun:test";

const BASE_URL = "http://localhost:3000/api/notifications";

describe("Notification API", () => {
    it("should generate a draft outreach email", async () => {
        const payload = {
            resume: {
                id: "test-resume-1",
                name: "Test Candidate",
                skills: ["React", "Node.js", "TypeScript"],
                workExperience: 5
            },
            jobDescription: {
                title: "Senior Frontend Engineer",
                company: "Tech Corp",
                requirements: "Expert in React and TypeScript"
            },
            analysis: {
                score: 95,
                recommendation: "strong_match",
                highlights: ["5 years experience", "Strong TypeScript skills"],
                concerns: [],
                summary: "Perfect match for the role."
            }
        };

        const res = await fetch(`${BASE_URL}/draft`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });

        const data = await res.json();
        console.log("Draft Response:", data);

        expect(res.status).toBe(200);
        expect(data).toHaveProperty("subject");
        expect(data).toHaveProperty("body");
        expect(data.subject).toBeString();
        expect(data.body).toBeString();
    });

    it("should send an email (Ethereal)", async () => {
        const payload = {
            to: "candidate@example.com",
            subject: "Interview Invitation",
            body: "Hello,\n\nWe would like to interview you."
        };

        const res = await fetch(`${BASE_URL}/send`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });

        const data = await res.json();
        console.log("Send Response:", data);

        expect(res.status).toBe(200);
        expect(data.success).toBe(true);
        expect(data.messageId).toBeString();
    });
});
