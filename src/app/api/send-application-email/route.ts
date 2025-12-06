import { Resend } from "resend";
import { NextResponse } from "next/server";

const resend = new Resend("re_CX8LWn8t_Gyt299oFZA6iycs622U8dTG2");

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      stationName,
      streamUrl,
      scheduleUrl,
      contactEmail,
      message,
      accentColor,
      logoUrl,
    } = body;

    const { data, error } = await resend.emails.send({
      from: "Channel <noreply@channel-app.com>",
      to: ["djradio@channel-app.com"],
      subject: `New Station Application: ${stationName}`,
      html: `
        <h2>New Station Application</h2>
        <p><strong>Station Name:</strong> ${stationName}</p>
        <p><strong>Contact Email:</strong> <a href="mailto:${contactEmail}">${contactEmail}</a></p>
        <p><strong>Stream URL:</strong> <a href="${streamUrl}">${streamUrl}</a></p>
        <p><strong>Schedule URL:</strong> <a href="${scheduleUrl}">${scheduleUrl}</a></p>
        <p><strong>Accent Color:</strong> <span style="background-color: ${accentColor}; padding: 2px 8px; color: white;">${accentColor}</span></p>
        ${logoUrl ? `<p><strong>Logo:</strong> <a href="${logoUrl}">View Logo</a></p>` : "<p><strong>Logo:</strong> Not provided</p>"}
        ${message ? `<p><strong>Message:</strong></p><p>${message}</p>` : ""}
        <hr />
        <p style="color: #666; font-size: 12px;">This application was submitted via channel-app.com</p>
      `,
    });

    if (error) {
      console.error("Resend error:", error);
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ success: true, id: data?.id });
  } catch (error) {
    console.error("Email send error:", error);
    return NextResponse.json(
      { error: "Failed to send email" },
      { status: 500 }
    );
  }
}
