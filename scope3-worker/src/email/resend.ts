import { Resend } from 'resend';

interface OnboardingEmailInput {
  apiKey:       string;
  to:           string;
  supplierName: string;
  orgName:      string;
  formUrl:      string;
  deadline?:    string;
}

export async function sendOnboardingEmail(input: OnboardingEmailInput): Promise<void> {
  const resend = new Resend(input.apiKey);

  await resend.emails.send({
    from:    'Scope3 盤點系統 <noreply@scope3.yao.care>',
    to:      input.to,
    subject: `【邀請】${input.orgName} Scope 3 碳排資料提交`,
    html: `
<h2>您好，${input.supplierName}</h2>
<p>${input.orgName} 邀請您透過以下連結提交 Scope 3 碳排資料：</p>
<p><a href="${input.formUrl}" style="display:inline-block;padding:12px 24px;background:#0070f3;color:#fff;text-decoration:none;border-radius:4px;">開始填寫資料</a></p>
<p>連結網址：<a href="${input.formUrl}">${input.formUrl}</a></p>
${input.deadline ? `<p>請於 <strong>${input.deadline}</strong> 前完成提交。</p>` : ''}
<hr>
<p style="color:#888;font-size:.85rem;">如有疑問，請聯繫 ESG 管理員。此連結為您專屬，請勿分享給他人。</p>
`,
  });
}
