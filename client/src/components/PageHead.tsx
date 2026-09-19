// Dashboard uses the greeting variant (hello + name + avatar); other screens
// will use the plain title-only variant as they migrate to this design.
export default function PageHead({ title, greeting, name }: { title: string; greeting?: string; name?: string }) {
  const initial = name?.trim()?.[0]?.toUpperCase() ?? '?';

  return (
    <div className="gd-page-head">
      <div>
        {greeting && <p className="gd-hello">{greeting}</p>}
        <h1>{name ? `${title}, ${name.split(' ')[0]}` : title}</h1>
      </div>
      {name && <div className="gd-avatar">{initial}</div>}
    </div>
  );
}
