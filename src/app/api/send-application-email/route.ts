import { Resend } from "resend";
import { NextResponse } from "next/server";

const resend = new Resend("re_CX8LWn8t_Gyt299oFZA6iycs622U8dTG2");

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      firstName,
      lastName,
      radioUrl,
      streamUrl,
      scheduleUrl,
      socialMedia,
      plays24_7,
      message,
    } = body;

    const { data, error } = await resend.emails.send({
      from: "Channel <noreply@channel-app.com>",
      to: ["djradio@channel-app.com"],
      subject: `New Station Application: ${radioUrl}`,
      html: `
        <h2>New Station Application</h2>
        <p><strong>Contact:</strong> ${firstName} ${lastName}</p>
        <p><strong>Radio Website:</strong> <a href="${radioUrl}">${radioUrl}</a></p>
        ${streamUrl ? `<p><strong>Stream URL:</strong> <a href="${streamUrl}">${streamUrl}</a></p>` : ""}
        ${scheduleUrl ? `<p><strong>Schedule URL:</strong> <a href="${scheduleUrl}">${scheduleUrl}</a></p>` : ""}
        ${socialMedia ? `<p><strong>Social Media:</strong> ${socialMedia}</p>` : ""}
        <p><strong>Plays 24/7:</strong> ${plays24_7 ? "Yes" : "No"}</p>
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
