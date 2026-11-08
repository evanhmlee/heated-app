import type { Metadata } from "next";
import {
  APP_NAME,
  CONTACT_EMAIL,
  LegalLink,
  LegalShell,
  P,
  Section,
  Strong,
  UL,
} from "@/components/legal";

export const metadata: Metadata = {
  title: `Privacy Policy | ${APP_NAME}`,
  description: `How ${APP_NAME} collects, uses, and protects your information.`,
};

export default function PrivacyPolicy() {
  return (
    <LegalShell
      title="Privacy Policy"
      updated="July 11, 2026"
      intro={
        <>
          <P>
            This Privacy Policy describes how {APP_NAME}{" "}(&quot;we,&quot;
            &quot;us,&quot; or &quot;our&quot;) collects, uses, and shares your
            information when you use our website and services (the
            &quot;Service&quot;), a platform where you argue basketball takes
            and debates by voice or text and an AI judge scores them.
          </P>
          <P>
            If you do not agree with this policy, please do not use the
            Service. Questions? Email us at{" "}
            <LegalLink href={`mailto:${CONTACT_EMAIL}`}>
              {CONTACT_EMAIL}
            </LegalLink>
            .
          </P>
        </>
      }
    >
      <Section title="1. Information we collect">
        <P>
          <Strong>Account information.</Strong> When you sign up we collect
          your email address, a password (stored in hashed form by our
          authentication provider), and a username. Your username is public: it
          appears on leaderboards and on any debate results you share. You may
          optionally add an avatar image.
        </P>
        <P>
          <Strong>Content you create.</Strong> The core of the Service is
          content you produce: voice recordings of your debate turns and daily
          takes, written arguments, and the debate topics you enter. From
          these we generate and store transcripts, AI verdicts, scores, and
          related statistics (points, wins, losses, streaks, badges).
        </P>
        <P>
          <Strong>Voice recordings of other people.</Strong> In head-to-head
          mode, a debate between two people can be recorded on one device. If
          you host such a debate, the other person&apos;s voice is recorded and
          transcribed, and the name you enter for them is stored and shown on
          the verdict. You are responsible for getting their permission first
          (see our <LegalLink href="/terms">Terms of Service</LegalLink>).
        </P>
        <P>
          <Strong>Live video debates.</Strong> Online head-to-head matches run
          over a live video and audio call powered by Daily (Daily.co), a video
          infrastructure provider. The call itself is live-only:{" "}
          <Strong>we do not record or store the video call</Strong>. Only your
          own microphone audio for your speaking turns is captured and
          transcribed, exactly as in other modes, and the audio is not retained
          after transcription. Daily processes the call media in transit; see
          the{" "}
          <LegalLink href="https://www.daily.co/legal/privacy">
            Daily Privacy Policy
          </LegalLink>
          . Your username, points, and win/loss record are visible to other
          players in lobbies and matches.
        </P>
        <P>
          <Strong>Payment information.</Strong> If you purchase a paid
          subscription, payment is handled by our payment processor, Stripe.
          We do not receive or store your full card details; we receive
          limited billing information such as your subscription status and a
          customer identifier. See the{" "}
          <LegalLink href="https://stripe.com/privacy">
            Stripe Privacy Policy
          </LegalLink>
          .
        </P>
        <P>
          <Strong>Automatically collected information.</Strong> Like most web
          services, our infrastructure providers automatically log technical
          data such as IP address, browser and device characteristics, and
          request logs, used for security, debugging, and operating the
          Service.
        </P>
      </Section>

      <Section title="2. How we use your information">
        <UL>
          <li>
            <Strong>To run the Service:</Strong> transcribing your recordings,
            generating AI verdicts and scores, keeping standings, awarding
            points and badges, and maintaining your account.
          </li>
          <li>
            <Strong>To operate leaderboards and shared results:</Strong>{" "}
            displaying your username, points, record, and badges to other
            users.
          </li>
          <li>
            <Strong>To moderate content:</Strong> screening submissions for
            inappropriate language and enforcing our rules.
          </li>
          <li>
            <Strong>To communicate with you:</Strong> account and service
            emails such as email confirmation, password resets, and important
            changes to the Service or these policies.
          </li>
          <li>
            <Strong>To improve and protect the Service:</Strong> understanding
            usage, fixing bugs, preventing fraud and abuse, and enforcing
            usage limits.
          </li>
          <li>
            <Strong>To comply with law:</Strong> responding to lawful requests
            and protecting our legal rights.
          </li>
        </UL>
      </Section>

      <Section title="3. Voice recordings and transcripts">
        <P>
          When you record a debate turn or daily take, the audio is sent to
          our transcription provider, AssemblyAI, which converts it to text.{" "}
          <Strong>
            We do not keep your original audio files on our servers.
          </Strong>{" "}
          What we store is the transcript, along with the AI verdict and
          scores derived from it, so you can review your past debates.
          AssemblyAI processes the audio as our service provider under its own
          privacy practices; see the{" "}
          <LegalLink href="https://www.assemblyai.com/legal/privacy-policy">
            AssemblyAI Privacy Policy
          </LegalLink>
          .
        </P>
      </Section>

      <Section title="4. AI processing">
        <P>
          The Service is built around AI features: debate judging, an AI
          opponent, topic generation, and scoring. To provide them, your
          transcripts and written arguments are processed by our AI provider,
          Anthropic, and your audio is processed by AssemblyAI, as described
          above. We send these providers only what is needed to deliver the
          feature. We do not use your content to train our own machine
          learning models. See the{" "}
          <LegalLink href="https://www.anthropic.com/legal/privacy">
            Anthropic Privacy Policy
          </LegalLink>
          .
        </P>
        <P>
          AI verdicts and scores are automated outputs generated for
          entertainment and informational purposes. They are not human
          judgments and may contain errors.
        </P>
      </Section>

      <Section title="5. What other people can see">
        <UL>
          <li>
            <Strong>Leaderboards:</Strong> your username, points, win/loss
            record, and badges are visible to other signed-in users.
          </li>
          <li>
            <Strong>Daily takes:</Strong> your daily take, its score, and your
            username may appear on the daily board visible to other signed-in
            users.
          </li>
          <li>
            <Strong>Shared verdicts:</Strong> each completed debate has a
            shareable results page and image showing the topic, sides, scores,
            and participant names. These pages are public web pages reachable
            by anyone with the link. Links use long, unguessable identifiers
            and are not listed anywhere, but anyone you (or your opponent)
            share a link with can view it and pass it on.
          </li>
        </UL>
      </Section>

      <Section title="6. When we share information">
        <P>
          We do not sell your personal information. We share it only with the
          service providers that run the Service, and in the limited
          situations below:
        </P>
        <UL>
          <li>
            <Strong>Infrastructure:</Strong> Supabase (authentication and
            database), Vercel (hosting), and Daily (live video calls for
            online debates; not recorded).
          </li>
          <li>
            <Strong>AI providers:</Strong> AssemblyAI (transcription) and
            Anthropic (judging, AI opponent, topic generation).
          </li>
          <li>
            <Strong>Payments:</Strong> Stripe (billing and subscription
            management).
          </li>
          <li>
            <Strong>Sports data:</Strong> we may query third-party basketball
            statistics providers to ground debate topics and verdicts; these
            queries do not include your personal information.
          </li>
          <li>
            <Strong>Legal:</Strong> when required by law, or to protect the
            rights, safety, or property of {APP_NAME}, our users, or others.
          </li>
          <li>
            <Strong>Business transfers:</Strong> in connection with a merger,
            acquisition, or sale of assets, in which case this policy will
            continue to apply to your information.
          </li>
        </UL>
      </Section>

      <Section title="7. Cookies">
        <P>
          We currently use only essential cookies: the session cookies our
          authentication provider needs to keep you signed in. We do not use
          advertising cookies. If we add analytics or other non-essential
          cookies in the future, we will update this policy.
        </P>
      </Section>

      <Section title="8. Data retention">
        <P>
          We keep your account information, transcripts, verdicts, and
          statistics for as long as you have an account, so your history and
          standings work. Original audio recordings are not retained after
          transcription, as described in Section 3. If you delete your
          account or ask us to, we will delete your personal information from
          our active systems, except for limited records we may need to keep
          for security, fraud prevention, or legal compliance.
        </P>
      </Section>

      <Section title="9. Your rights and choices">
        <P>
          You can update your username and avatar in the app. For anything
          else, email us at{" "}
          <LegalLink href={`mailto:${CONTACT_EMAIL}`}>
            {CONTACT_EMAIL}
          </LegalLink>{" "}
          and we will honor the rights available to you under applicable law,
          including:
        </P>
        <UL>
          <li>access to the personal information we hold about you;</li>
          <li>correction of inaccurate information;</li>
          <li>deletion of your account and personal information;</li>
          <li>a copy of the information you provided to us; and</li>
          <li>
            withdrawal of consent where our processing relies on consent.
          </li>
        </UL>
        <P>
          Depending on where you live (including a number of US states), some
          of these rights are guaranteed by statute, and you also have the
          right not to be discriminated against for exercising them. We will
          verify your request and respond within the time required by
          applicable law.
        </P>
      </Section>

      <Section title="10. Children">
        <P>
          The Service is not directed to children under 13, and we do not
          knowingly collect personal information from children under 13. If
          you are under 18, you may use the Service only with the permission
          of a parent or guardian. If you believe a child under 13 has
          provided us personal information, contact us at{" "}
          <LegalLink href={`mailto:${CONTACT_EMAIL}`}>
            {CONTACT_EMAIL}
          </LegalLink>{" "}
          and we will delete it.
        </P>
      </Section>

      <Section title="11. Security">
        <P>
          We use reasonable technical and organizational measures to protect
          your information, including encrypted connections, hashed
          passwords, and access controls that restrict what clients can read
          and write. No method of transmission or storage is completely
          secure, so we cannot guarantee absolute security.
        </P>
      </Section>

      <Section title="12. International users">
        <P>
          The Service is operated from the United States and your information
          is processed and stored there. If you use the Service from outside
          the United States, you understand that your information will be
          transferred to and processed in the United States, where privacy
          laws may differ from those in your jurisdiction.
        </P>
      </Section>

      <Section title="13. Changes to this policy">
        <P>
          We may update this Privacy Policy from time to time. When we do, we
          will revise the &quot;Last updated&quot; date at the top, and for
          material changes we will provide additional notice, such as an
          in-app message or email. Continued use of the Service after changes
          take effect means you accept the updated policy.
        </P>
      </Section>

      <Section title="14. Contact us">
        <P>
          {APP_NAME}
          <br />
          San Diego, CA, United States
          <br />
          <LegalLink href={`mailto:${CONTACT_EMAIL}`}>
            {CONTACT_EMAIL}
          </LegalLink>
        </P>
      </Section>
    </LegalShell>
  );
}
