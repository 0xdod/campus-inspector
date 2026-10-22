export function BackendLaunchGuide() {
  return (
    <>
      <p>
        Activate the saved profile for this app, then call one of these Campus
        endpoints using that environment’s request base and your Campus session:
      </p>
      <div className="endpoint">
        <span>Student session</span>
        <code>GET /students/campus-apps/&#123;appId&#125;/launch</code>
      </div>
      <div className="endpoint">
        <span>Administrator session</span>
        <code>GET /admin/campus-apps/&#123;appId&#125;/launch</code>
      </div>
      <p>
        Use the numeric app ID returned by Campus registration. This is separate
        from the client ID and installation ID.
      </p>
      <p>
        Open the initiation URL in the response’s <code>data</code> field in
        your browser within five minutes. The inspector handles the user ID and
        reference automatically, then inspects the form-post callback. Each URL
        is single use; request a new one for each launch.
      </p>
      <p className="caption">
        Use a direct student or administrator session; impersonation is
        rejected. Administrator launch requires system-scoped{" "}
        <code>campus_apps.app.read</code>. Keep Campus session tokens in your
        authorized API client.
      </p>
    </>
  );
}
