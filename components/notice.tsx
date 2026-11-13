export function Notice({
  error,
  success
}: {
  error?: string;
  success?: string;
}) {
  return (
    <>
      {error && <p className="error" role="alert">{error}</p>}
      {success && <p className="notice" role="status">요청이 반영되었습니다.</p>}
    </>
  );
}
