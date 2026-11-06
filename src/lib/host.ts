/** The public owner phone site. The store computer does not set this. */
export function isOwnerWeb() {
  return process.env.VANO_WEB === "1";
}
